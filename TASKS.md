# Task Board — Interview Presence & Credibility Module

**Project key:** `IC`
**Reference:** [PRD.md](PRD.md)
**Timebox:** ~24h focused build
**Last updated:** 2026-07-21

---

## Phases

| Phase | Name | PRD milestone | Est. | Gate to exit |
|---|---|---|---|---|
| **P0** | Foundation & scaffolding | — | 1h | `npm run dev` serves; `npm test` green |
| **P1** | Camera & detection pipeline | M1 | 3h | Live feed + box at ≥10fps; permission errors handled |
| **P2** | Core presence detection | M2 | 2h | Present/absent flips correctly with debug panel |
| **P3** | Alert & timeout | M3 | 2h | Prompt + countdown + single timeout event |
| **P4** | Detection stabilization | M4 | 4h | **Zero** prompts in a 10-min natural session |
| **P5** | Environmental conditions | M5 | 4h | Lighting / occlusion / multi-face all validated |
| **P6** | Mask & liveness | M6 | 4h | Mask present-throughout; photo flagged; still person not |
| **P7** | Config & handoff | M7 | 2h | API documented; integration notes written |

Phases are sequential. P4 is the one most likely to overrun — the "zero false
alerts" gate is empirical, not a coding task. Protect its budget by not gold-plating P1–P3.

---

## Kanban

### 📋 Backlog

| ID | Title | Phase | Est. |
|---|---|---|---|
| IC-23 | Occlusion detection via landmark visibility drop | P5 | 1.5h |
| IC-31 | Persist tuned config to localStorage | P7 | 0.5h |
| IC-38 | Browser matrix: Chrome / Edge / Safari verification | P7 | 1h |
| IC-39 | CPU/GPU delegate benchmark alongside a live voice session | P7 | 1h |
| IC-40 | Challenge-response liveness (deferred — replay-video gap) | — | — |
| IC-41 | Persist integrity summary to `humanlens-agent` backend | — | — |

### 🔜 To Do

**Phase 1 — Camera & detection pipeline (M1)** — _all moved to In Review_

**Phase 2 — Core presence detection (M2)**

| ID | Title | Est. | Depends on |
|---|---|---|---|
| IC-22 | Bounding-box overlay on canvas | 0.5h | IC-20 |
| IC-27 | Debug panel: confidence, face count, fps, state, presence ratio | 0.5h | IC-20 |

**Phase 3 — Alert & timeout (M3)**

| ID | Title | Est. | Depends on |
|---|---|---|---|
| IC-25 | Return prompt + live countdown from absence events | 1h | IC-20 |
| IC-26 | Terminal "interview ended" state on `absence:timeout` | 0.5h | IC-25 |
| IC-28 | Verify timeout fires exactly once and reads from config | 0.5h | IC-26 |

**Phase 4 — Detection stabilization (M4)**

| ID | Title | Est. | Depends on |
|---|---|---|---|
| IC-29 | **Calibrate buffer/hysteresis against a real 10-min session** | 2h | IC-27 |
| IC-32 | Natural-movement soak test: turn, reach, drink, adjust posture | 1h | IC-29 |
| IC-33 | 1s look-away → no prompt; 5s exit → prompt (paired test) | 0.5h | IC-29 |

**Phase 5 — Environmental conditions (M5)**

| ID | Title | Est. | Depends on |
|---|---|---|---|
| IC-24 | Calibrate luma threshold — **incl. dark skin tones** (fairness) | 1.5h | IC-29 |
| IC-34 | Verify escalation suspends while degraded, resumes cleanly | 1h | IC-24 |
| IC-35 | Partial-occlusion validation: hand, hair, glasses glare | 1h | IC-29 |
| IC-36 | Multi-face validation against the three policies | 1h | IC-29 |

**Phase 6 — Mask & liveness (M6)**

| ID | Title | Est. | Depends on |
|---|---|---|---|
| IC-30 | **Calibrate liveness thresholds against recorded clips** | 2h | IC-16, IC-18 |
| IC-37 | Mask validation — surgical + cloth, present throughout | 1h | IC-29 |

**Phase 7 — Config & handoff (M7)**

| ID | Title | Est. | Depends on |
|---|---|---|---|
| IC-42 | Public API docs in README: init, start, stop, subscribe, summary | 1h | IC-30 |
| IC-43 | Integration notes for the interview client | 1h | IC-42 |

### 🚧 In Progress

| ID | Title | Est. | Note |
|---|---|---|---|
| IC-20 | Sample loop on `requestVideoFrameCallback`, throttled to `targetFps` | 1h | Loop written; AC requires a **measured** ≥10fps, which needs the model present |

### 👀 In Review

Code complete, awaiting verification against a real camera. **None of these can close
until `npm run fetch:model` has been run and the harness opened in a browser** — their
acceptance criteria are physical, and marking them Done on inspection is exactly the
failure this project is about.

| ID | Title | Verified so far | Outstanding |
|---|---|---|---|
| IC-11 | `CameraSource.start()` — getUserMedia + injected-stream path | Typecheck; ownership split written | Real permission denial / busy device / injected stream |
| IC-13 | Track `ended` listener → `camera:error(track-ended)` | Wired to runtime | Physically unplug a camera |
| IC-14 | Load MediaPipe WASM + `face_landmarker` task bundle | WASM synced locally (6 files) | Model not downloaded yet |
| IC-15 | `detect()` via `detectForVideo` with monotonic timestamps | Typecheck; monotonic guard written | A real detection |
| IC-16 | Derive yaw/pitch/roll from `facialTransformationMatrixes` | **Unit tested** — identity, yaw, pitch, gimbal lock | Real head movement |
| IC-17 | Mean-luma computation for the quality monitor | Rec. 601 on a 32×32 downscale | Real low-light frames (IC-24) |
| IC-18 | Normalised landmark displacement for micro-motion | Bounding-box scaling **unit tested** | Real motion values |
| IC-19 | GPU delegate with CPU fallback; log chosen delegate | Fallback written, logs delegate | Which delegate actually loads here |
| IC-21 | Discontinuity detection (sleep/resume) → `machine.reset()` | Threshold logic written | Real lid-close / resume |

### ✅ Done

| ID | Title | Phase |
|---|---|---|
| IC-12 | Map `DOMException` → `CameraErrorReason` per browser (5 unit tests; Safari deferred to IC-38) | P1 |
| IC-01 | PRD written and decisions recorded | P0 |
| IC-02 | Vite + TypeScript project scaffolded (Vite 6, pinned for Node 20.11) | P0 |
| IC-03 | Core module structure: types, config, emitter, runtime | P0 |
| IC-05 | `PresenceMachine` implemented — rolling buffer + hysteresis | P0 |
| IC-06 | `LivenessScorer` implemented — blink, pose variance, micro-motion | P0 |
| IC-07 | `QualityMonitor` implemented — low-light / low-fps with debounce | P0 |
| IC-08 | `SessionSummaryBuilder` implemented | P0 |
| IC-09 | Camera-free unit tests for machine + scorer (20 cases) | P0 |
| IC-10 | Demo harness shell: video stage, config sliders, event log | P0 |
| IC-44 | `docs/test-matrix.md` — manual physical test script | P0 |

---

## Ticket detail

Only the tickets whose acceptance criteria are non-obvious. The rest are self-describing.

### IC-11 — `CameraSource.start()`
**Why it matters:** the host app almost certainly already holds a `MediaStream`. Two
`getUserMedia` calls against one device is the top cause of `device-busy` on Windows.
**AC:**
- Accepts an injected `MediaStream` and does **not** call `getUserMedia` in that path
- When it does acquire, it owns the stream and stops all tracks on `stop()`
- When the stream is injected, `stop()` leaves the tracks running — not ours to kill
- Permission denial, no device, and device-busy each produce the right `camera:error`

### IC-20 — Sample loop
**AC:**
- Sampling decoupled from render; interview UI never janks
- Sustains ≥10fps on a mid-range laptop; measured, not assumed
- Backgrounded tab throttling is detected as `low-fps`, **not** as absence

### IC-21 — Discontinuity detection
**Why it matters:** without it, closing a laptop lid and reopening it looks like a
multi-minute absence and times the candidate out for something harmless.
**AC:**
- Gap > 2× expected frame interval calls `machine.reset()`
- No `absence:*` event is emitted for the gap itself
- Covered by the existing reset test

### IC-24 — Luma threshold calibration (fairness)
**Why it matters:** face detectors degrade unevenly across skin tones. A threshold
tuned only on light skin turns "poor lighting" into "this candidate gets falsely
marked absent," which is a fairness bug, not a lighting bug.
**AC:**
- Validated against low-light captures spanning a range of skin tones
- In every low-light case the outcome is `quality:degraded`, never `absence:started`
- Findings written up in `docs/test-matrix.md`, including any case that still fails

### IC-29 — Buffer/hysteresis calibration
**The single highest-risk ticket.** M4's gate is empirical.
**AC:**
- Zero prompts across a 10-minute seated session with natural movement
- 1s deliberate look-away → no prompt; 5s deliberate exit → prompt
- Final values written back into `DEFAULT_CONFIG` with a comment on how they were derived

### IC-30 — Liveness threshold calibration
**AC:**
- Held photo flagged within two windows
- Static taped photo flagged
- Live person sitting still for 3 min **not** flagged ← the metric that matters
- Flag never terminates a session, never produces candidate-facing accusatory copy

### IC-37 — Mask validation
**Why it matters:** called out explicitly because it is a known weak point of some
face detectors, and failing it would mark masked candidates absent for their whole interview.
**AC:** ≥95% of frames marked present, surgical and cloth masks, across lighting conditions.

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| P4 calibration overruns the timebox | P4 | Keep P1–P3 minimal; the gate is empirical and cannot be rushed |
| Liveness false positives on honest candidates | P6 | Two-signal rule, generous windows; tune FP rate before catch rate |
| MediaPipe WASM/GPU varies by browser | P1/P7 | IC-19 fallback + IC-38 matrix; state a minimum-browser requirement |
| Detection CPU competes with the live voice agent | P1 | Cap `targetFps`, sample off main thread, measure under real load (IC-39) |
| Replayed video defeats passive liveness | P6 | Accepted and documented; IC-40 deferred |

---

## Blocked / needs an answer

| # | Question | Blocks | Owner |
|---|---|---|---|
| 1 | Does the interview client already hold a `MediaStream` we should accept? | IC-11 | Host app team |
| 2 | Should the integrity summary be persisted server-side, and under what retention? | IC-41 | Product / legal |
| 3 | Who consumes the summary — recruiter, or automated scoring? | IC-42 | Product |
| 4 | Final wording for the return prompt (must stay neutral, non-accusatory) | IC-25 | Product |

Question 1 is the only one blocking Phase 1. The others can be answered in parallel.
