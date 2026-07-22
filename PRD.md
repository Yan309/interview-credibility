# PRD — Interview Presence & Credibility Module

**Status:** Draft
**Owner:** Aliyan
**Created:** 2026-07-21
**Target:** ~24h focused build, standalone prototype → integration-ready module
**Integrates with:** Forven / HumanLens interview app (browser interview client; `humanlens-agent` FastAPI backend)

---

## 1. Objective

Ensure interview integrity by detecting when a candidate is no longer visible on camera,
prompting them to return, and signalling the host application to end the session if they
remain absent beyond a configurable time limit.

Secondary objective: raise a soft credibility signal when the "face" in frame shows no
signs of life (static photo, printed image, looping video), without blocking the interview.

## 2. Background

Interviews run as a live browser session against a voice agent. Today nothing verifies that
the human who started the interview is still in front of the camera for its duration. This
module closes that gap. It is being built standalone so it can be tuned and tested in
isolation, then dropped into the interview client as a dependency.

## 3. Scope

### In scope
- Camera acquisition, permission and device-failure handling
- Face presence / absence detection from the live video stream
- Temporal buffering so momentary drops do not trigger alerts
- Return prompt on sustained absence; timeout event on prolonged absence
- Blink + head-pose liveness scoring, surfaced as a non-blocking flag
- Handling of: poor lighting, partial occlusion, face masks, multiple faces in frame
- Configurable timeouts and sensitivity, exposed as a typed config object
- Structured event stream + session summary for the host app

### Out of scope (explicit non-goals)
- **Identity verification** — we do not check *who* the person is, only that *a live person* is there
- Gaze / attention tracking ("is the candidate looking away")
- Screen-share, second-device, or off-camera-assistant detection
- Audio-based presence
- Server-side video processing, recording, or storage of any frame data
- Final adjudication — the module never decides that a candidate cheated

## 4. Users & stakeholders

| Who | Need |
|---|---|
| Candidate | Clear, non-hostile feedback when they drop out of frame; no false accusations |
| Interview app (host) | A dependable event stream it can act on; no video plumbing of its own |
| Reviewer / recruiter | A post-session integrity summary with timestamps, not raw footage |

## 5. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where detection runs | **Browser-side, TypeScript** | The interview is already a web session. Frames never leave the device → no candidate-video privacy obligations, no server GPU cost, no bandwidth. |
| Detection model | **MediaPipe Tasks Vision — Face Landmarker** (WASM/GPU) | One model yields presence, 478 landmarks, blink blendshapes, and a facial transformation matrix for head pose. Avoids running a second model for liveness. |
| Liveness depth | **Blink + head-pose variance over a rolling window** | Passive, no candidate action required, catches printed photos and static images. Depth/IR spoof resistance is explicitly not attempted. |
| Timeout behaviour | **Module emits events; host app terminates** | Keeps this a pure detector. The interview app owns session lifecycle, transcripts and cleanup — it must remain the one that ends things. |
| Distribution | ES module + typed events, framework-agnostic core | Core logic has no React/Vue dependency; the demo UI is a thin shell over it. |

## 6. Technical approach

### 6.1 Pipeline

```
getUserMedia ──▶ <video> ──▶ frame sampler (target 10 fps, configurable)
                                    │
                                    ▼
                         MediaPipe FaceLandmarker.detectForVideo()
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
       face count +          blendshapes           transformation
       confidence            (eyeBlink L/R)        matrix → yaw/pitch/roll
              │                     │                     │
              ▼                     └────────┬────────────┘
      PresenceStateMachine                   ▼
      (rolling buffer)              LivenessScorer (rolling window)
              │                              │
              └──────────┬───────────────────┘
                         ▼
                   EventEmitter → host app
```

Detection runs off the main thread where possible; frame sampling is decoupled from
render rate so the interview UI never janks because of us.

### 6.2 Presence state machine

States: `INITIALIZING → PRESENT ⇄ ABSENT_PENDING → ABSENT → TIMED_OUT`
plus terminal-ish `CAMERA_ERROR` and advisory `DEGRADED`.

| Transition | Condition |
|---|---|
| `PRESENT → ABSENT_PENDING` | Presence ratio in the rolling window drops below `absenceEnterRatio` |
| `ABSENT_PENDING → PRESENT` | Face recovered before `absenceGraceMs` elapses — **no prompt shown** |
| `ABSENT_PENDING → ABSENT` | `absenceGraceMs` elapsed with sustained absence → emit `absence:started`, host shows prompt |
| `ABSENT → PRESENT` | Presence ratio exceeds `presenceRecoverRatio` for `recoveryConfirmMs` → emit `absence:resolved` |
| `ABSENT → TIMED_OUT` | `absenceTimeoutMs` elapsed since `absence:started` → emit `absence:timeout` |

Hysteresis is deliberate: the ratio to *enter* absence is stricter than the ratio to
*recover*, so a candidate hovering at the edge of frame does not flap between states.

### 6.3 Liveness scoring

Over a rolling `livenessWindowMs` (default 20s), while a face is present:

- **Blink signal** — count blink events from `eyeBlinkLeft`/`eyeBlinkRight` blendshapes crossing
  `blinkThreshold` with a refractory period. Expected human rate ≈ 10–20/min; flag below `minBlinksPerWindow`.
- **Head-pose signal** — variance of yaw/pitch/roll derived from the transformation matrix.
  A held photo still wobbles; a taped photo does not. Flag below `minPoseVariance`.
- **Micro-motion signal** — mean absolute landmark displacement between frames, as a
  cheap corroborator for the two above.

A `liveness:suspect` event fires only when **two or more** signals are simultaneously below
threshold for a full window, and it is **advisory** — it never drives termination. It resolves
with `liveness:cleared` once signals recover.

### 6.4 Configuration surface

```ts
interface PresenceConfig {
  // sampling
  targetFps: number;              // default 10
  // presence
  minFaceConfidence: number;      // default 0.5
  bufferWindowMs: number;         // default 2000
  absenceEnterRatio: number;      // default 0.2  — <20% of window had a face
  presenceRecoverRatio: number;   // default 0.6
  absenceGraceMs: number;         // default 3000  — silent grace before prompting
  recoveryConfirmMs: number;      // default 1000
  absenceTimeoutMs: number;       // default 30000 — prompt → timeout event
  // multi-face
  multiFacePolicy: 'ignore' | 'flag' | 'treat-as-absent';  // default 'flag'
  multiFaceGraceMs: number;       // default 5000
  // quality
  lowLightLumaThreshold: number;  // default 40 (0–255 mean luma)
  // liveness
  liveness: { enabled: boolean; windowMs: number; blinkThreshold: number;
              minBlinksPerWindow: number; minPoseVariance: number; };
}
```

All values overridable per session by the host app. Defaults live in one file, are documented
inline, and the demo harness exposes every knob as a live control for tuning.

### 6.5 Event contract

```ts
type PresenceEvent =
  | { type: 'session:started';    at: number }
  | { type: 'presence:changed';   at: number; present: boolean; confidence: number }
  | { type: 'absence:started';    at: number }                    // host: show return prompt
  | { type: 'absence:resolved';   at: number; durationMs: number } // host: hide prompt
  | { type: 'absence:timeout';    at: number; durationMs: number } // host: end interview
  | { type: 'multiface:detected'; at: number; faceCount: number }
  | { type: 'multiface:cleared';  at: number }
  | { type: 'liveness:suspect';   at: number; signals: string[] }
  | { type: 'liveness:cleared';   at: number }
  | { type: 'quality:degraded';   at: number; reason: 'low-light' | 'occluded' | 'low-fps' }
  | { type: 'quality:restored';   at: number }
  | { type: 'camera:error';       at: number; reason: 'permission-denied' | 'no-device'
                                                    | 'device-busy' | 'track-ended' };
```

Every event carries a monotonic timestamp. The module also exposes `getSessionSummary()`
returning total absence count, cumulative absent time, longest absence, multi-face
occurrences, liveness flags and degraded-quality periods — this is what a reviewer sees.

**Privacy invariant:** no frame, landmark set, or image ever leaves the browser. Events carry
scalars and timestamps only. This is a hard constraint, asserted by test.

## 7. Milestones & acceptance criteria

Ordered as the build will actually proceed. Each milestone is demoable.

### M1 — Project setup complete
Standalone Vite + TypeScript app runs locally with live camera feed and MediaPipe Face
Landmarker wired in.
- ✅ `npm run dev` serves a page showing the camera feed with a live face bounding box
- ✅ Detections sustain ≥ 10 fps on a mid-range laptop without visible UI lag
- ✅ Permission denial and no-camera-attached both render a clear message, not a blank screen

### M2 — Core presence detection working
Raw present/absent determination from the detector.
- ✅ Walking out of frame flips state to absent within ~1s; returning flips it back
- ✅ Covering the lens registers absence, not a stale "present"
- ✅ On-screen debug panel shows confidence, face count, fps, current state

### M3 — Alert & timeout functional
- ✅ Sustained absence past `absenceGraceMs` shows the return prompt with a visible countdown
- ✅ Returning to frame dismisses the prompt and resets the countdown
- ✅ Staying away past `absenceTimeoutMs` emits `absence:timeout` exactly once, and the demo
  shell renders a terminal "interview ended" state
- ✅ Timeout value is read from config, not hardcoded

### M4 — Detection stabilized
Buffering so brief movements and detector glitches do not cause false alerts.
- ✅ Rolling-window buffer + hysteresis implemented per §6.2
- ✅ **Zero** prompts across a 10-minute seated session with natural movement (turning to think,
  reaching off-desk, adjusting posture, drinking)
- ✅ A deliberate 1-second look-away produces no prompt; a deliberate 5-second exit does
- ✅ Unit tests drive the state machine from synthetic detection sequences — no camera needed in CI

### M5 — Common conditions handled
- ✅ **Poor lighting:** below `lowLightLumaThreshold` emits `quality:degraded`, and absence
  escalation is suspended while degraded — we report "we can't see you clearly", we do not
  accuse someone of leaving because their room is dim
- ✅ **Partial obstruction:** hand over chin/mouth, hair across face, glasses glare → still present
- ✅ **Multiple people:** a second face in frame emits `multiface:detected` after
  `multiFaceGraceMs`, without disturbing the primary presence track (default policy `flag`)
- ✅ Each condition captured as a recorded test clip or scripted manual test in `docs/test-matrix.md`

### M6 — Mask & spoof handling
- ✅ Candidate wearing a surgical / cloth face mask is detected as **present** throughout
  (verified explicitly — this is a known weak point of some detectors)
- ✅ Held photo of a face triggers `liveness:suspect` within two windows
- ✅ Static image taped in front of the lens triggers `liveness:suspect`
- ✅ A live person sitting unusually still does **not** trigger it within a 3-minute session
  (false-positive rate is the metric that matters here)
- ✅ Liveness flags never terminate the session and never surface accusatory copy to the candidate

### M7 — Configurable & handoff-ready
- ✅ Full `PresenceConfig` surface exposed and adjustable at runtime in the demo
- ✅ Core detection logic has no UI-framework dependency; demo UI is a separate layer
- ✅ Public API documented in `README.md`: init, start, stop, subscribe, getSessionSummary
- ✅ Integration notes cover mounting into the interview client and which events the host
  must handle for the session to end correctly

## 8. Success metrics

| Metric | Target |
|---|---|
| False-alert rate | 0 prompts per 10-min normal seated session |
| True-absence detection latency | prompt within `absenceGraceMs` + 1s of leaving frame |
| Mask-wearing detection rate | ≥ 95% of frames marked present |
| Liveness false-positive rate | < 1 suspect flag per 30 min of live-person session |
| Runtime cost | ≤ 10% CPU on a mid-range laptop; no dropped frames in the interview UI |

## 9. Edge cases to handle

| Case | Expected behaviour |
|---|---|
| Camera permission denied at start | `camera:error(permission-denied)`; host blocks interview start |
| Camera revoked / unplugged mid-session | `camera:error(track-ended)`; treated as absence, not a crash |
| Camera occupied by another app | `camera:error(device-busy)` with retry guidance |
| Browser tab backgrounded | `requestVideoFrameCallback` throttles → detect the fps drop and pause escalation rather than firing a spurious timeout |
| Laptop sleeps / lid closed | On resume, discard the stale buffer window; do not back-date absence |
| Candidate leans far back or very close | Still present; distance is not absence |
| Very dark skin tones in low light | Covered by M5 lighting handling — must be validated as a fairness case, not just a lighting case |
| Virtual background / heavy beauty filters | Should remain present; note as a known-risk item if it regresses |
| Two candidates swap seats mid-interview | Out of scope (identity) — but the swap produces a `multiface` blip that lands in the summary |

## 10. Risks & open questions

| Risk | Mitigation |
|---|---|
| Liveness false positives annoy honest candidates | Advisory-only, two-signal requirement, generous windows; tune false-positive rate before sensitivity |
| MediaPipe WASM/GPU support varies by browser | Test Chrome + Edge + Safari; document a graceful CPU fallback and a minimum-browser statement |
| Detection cost competes with the live voice agent for CPU | Cap `targetFps`, sample off the main thread, measure alongside a real interview session |
| Timeout ends a legitimate interview | Grace period, hysteresis, degraded-quality suspension, and host-side final say |
| Candidates could game it with a video loop | Acknowledged gap — passive liveness does not defeat a replayed video; note for a future challenge-response milestone |

**Open questions**
1. Does the host interview client already own camera permission and a `MediaStream` we should
   attach to, rather than calling `getUserMedia` ourselves? (Likely yes — API should accept an
   injected stream.)
2. Should the absence timeline be persisted to the `humanlens-agent` backend as part of the
   session record, and under what retention policy?
3. Who reads the integrity summary — recruiter, or an automated scoring step?
4. What copy should the return prompt use? Needs to be neutral and non-accusatory.

## 11. Deliverables

- Standalone local app demonstrating all seven milestones
- `src/core/` — framework-agnostic detection module (the thing that ships)
- `src/demo/` — tuning harness with live config controls and event log
- Unit tests over the state machine and liveness scorer, runnable without a camera
- `docs/test-matrix.md` — manual test script for the physical conditions in M5/M6
- `README.md` — public API and integration notes for the interview app
