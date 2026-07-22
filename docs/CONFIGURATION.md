# Configuration Reference

Every knob in `PresenceConfig`, what it actually does, and what happens if you move it
the wrong way. Defaults live in [`src/core/config.ts`](../src/core/config.ts) and are all
overridable per session.

Values marked **uncalibrated** are starting points, not conclusions. They get set properly
in Phase 4–6 against a real camera.

---

## Sampling

### `targetFps` — default `10`
How many times per second the detector runs. Not the camera's frame rate — the camera
delivers ~30fps and we deliberately sample a fraction of them.

- **Higher:** faster reaction, more CPU. That CPU is shared with a live voice agent.
- **Lower:** less CPU, but presence changes are noticed later.
- 10 is enough because presence decisions are made over seconds, not frames.

> Frames arrive on a ~33ms grid, so the loop can only sample on frame boundaries. Asking
> for 12fps gets you 10 or 15, not 12.

---

## Presence

These five decide whether the candidate counts as present. They are the ones that matter
for Phase 4, and they interact — tune them in the order given in [`/tune`](../.claude/skills/tune/SKILL.md).

### `minFaceConfidence` — default `0.5`
Minimum detector confidence for a face to count.

**Important:** this is pushed *down* into MediaPipe's own threshold rather than compared
after the fact — `FaceLandmarkerResult` carries no per-face score. Raising it doesn't make
detection "stricter" in a useful way; it mostly converts masked, dimly-lit, and
off-angle candidates into false absences. **Reach for `bufferWindowMs` instead.**

### `bufferWindowMs` — default `2000` · **uncalibrated**
The rolling window presence is judged over. Presence is never decided from one frame — it
is the *ratio* of face-present samples across this window.

- **Longer:** absorbs more noise, fewer false alerts, slower to notice a real absence.
- **Shorter:** twitchier. Below ~1000ms a single dropped detection starts moving the state.
- **This is the first knob to reach for** when you see false alerts.

### `absenceEnterRatio` — default `0.2`
Presence ratio *below which* absence begins. At 0.2, fewer than 20% of samples in the
window had a face.

### `presenceRecoverRatio` — default `0.6`
Presence ratio *above which* the candidate counts as back.

**The gap between these two is the hysteresis band, and it is the point.** With a single
threshold, a candidate sitting at the edge of frame oscillates between present and absent
several times a second. Requiring more evidence to recover than to leave makes the state
settle.

`resolveConfig` **throws** if `presenceRecoverRatio <= absenceEnterRatio`. That guard is
load-bearing: an inverted band doesn't look like a config error, it looks like a flaky
detector, and you can lose hours to it.

- **Narrow gap (e.g. 0.4 / 0.5):** more responsive, flapping returns.
- **Wide gap (e.g. 0.1 / 0.8):** very stable, slow to acknowledge a return.

### `absenceGraceMs` — default `3000` · **uncalibrated**
Silent time after absence begins before the candidate sees anything. A 1–2 second look
away costs them nothing — no prompt, no countdown, no record.

**The bluntest instrument here.** If raising grace "fixes" a false-alert problem, the
detection layer almost certainly still has the problem and grace is hiding it. Tune the
window and the band first.

### `recoveryConfirmMs` — default `1000`
How long recovery must hold before a *prompted* absence clears. Stops the prompt
flickering off and on while someone settles back into their chair.

### `absenceTimeoutMs` — default `30000`
From `absence:started` to `absence:timeout`. This is the countdown the candidate sees.

The module **emits an event; it does not end the interview.** Your app decides.

---

## Multi-face

### `multiFacePolicy` — default `'flag'`
What a second face in frame means.

| Value | Behaviour |
|---|---|
| `'ignore'` | No multi-face detection at all |
| `'flag'` | Emits `multiface:detected`, presence unaffected — **default** |
| `'treat-as-absent'` | A second face counts as the candidate not being properly present |

`'flag'` is the default because a second face is not proof of anything. Someone's family
walking behind them is not misconduct, and `'treat-as-absent'` would end interviews for
candidates without a private room to sit in.

### `multiFaceGraceMs` — default `5000`
How long a second face must persist before flagging. Stops someone walking past the door
from generating a record.

---

## Camera quality

Quality detection exists so that "we cannot see well enough to judge" stays distinct from
"the candidate left". While quality is degraded, **absence escalation is suspended** — the
absence clock freezes rather than counting down.

### `lowLightLumaThreshold` — default `40` · **uncalibrated (fairness-critical)**
Mean frame luma (0–255) below which the image is too dark to judge.

**This is the single most sensitive number in the config.** Face detection degrades
unevenly across skin tones, so a threshold tuned only on light skin systematically
misclassifies darker-skinned candidates in the same room lighting. IC-24 calibrates this
against multiple real people; it cannot be set by reasoning about it.

- **Too high:** ordinary rooms get flagged as unusable.
- **Too low:** genuinely unusable frames get treated as reliable, and the fairness
  protection never engages.

### `lowFpsThreshold` — default `4`
Sampling rate below which the feed counts as degraded. Catches backgrounded tabs and
throttled machines — which must read as a quality problem, never as an absence.

### `qualityDebounceMs` — default `2000`
How long a quality problem must persist before it is reported. Stops someone walking past
a window from triggering a lighting prompt.

### `lightingTimeoutMs` — default `60000` · **uncalibrated**
Time the candidate gets to fix unusable conditions before `quality:timeout` fires.

Twice `absenceTimeoutMs` on purpose: stepping back into frame takes seconds, but fixing a
room's lighting means standing up, finding a lamp, and moving furniture.

**Two conditions are both required for this clock to run:** the frame is degraded **and**
no face is detectable. If the candidate is still visible despite poor lighting, the clock
never starts — they are demonstrably present.

> See [Invariant 3](../CLAUDE.md) — this timer is a deliberate, recorded exception to the
> original "degraded quality never terminates" rule. Raising the default is safer than
> lowering it.

---

## Liveness

All advisory. Nothing here ever ends a session, and none of it is shown to the candidate.

### `liveness.enabled` — default `true`
Master switch. Disabling also lets you turn off blendshape output in the detector, which
saves some CPU.

### `liveness.windowMs` — default `20000`
Rolling window for judging signs of life. Nothing is judged until a full window has
elapsed — otherwise you flag someone for not happening to blink in their first two seconds.

### `liveness.blinkThreshold` — default `0.5`
Blendshape score above which an eye counts as closed.

### `liveness.blinkRefractoryMs` — default `200`
Minimum gap between counted blinks, so one blink spanning several frames counts once.

### `liveness.minBlinksPerWindow` — default `2` · **uncalibrated**
Below this many blinks in a window, the blink signal reads as dead. Humans blink 10–20
times a minute, so 2 per 20s window is deliberately forgiving — concentration reduces
blink rate substantially.

### `liveness.minPoseVariance` — default `0.5` · **uncalibrated**
Summed variance of yaw/pitch/roll (deg²) below which head pose reads as dead. A held photo
still wobbles; a taped one does not.

### `liveness.minMotion` — default `0.0015` · **uncalibrated**
Mean landmark displacement, normalised by face size, below which micro-motion reads as
dead. The normalisation matters — without it, sitting closer to the camera reads as
"more alive".

### `liveness.minSignalsToFlag` — default `2`
How many dead signals must coincide before flagging.

**Do not lower this to 1.** People sit still. The metric that matters is the
false-positive rate on an honest candidate, not the catch rate on a photo — a missed photo
costs far less than accusing someone who did nothing wrong. If you find yourself lowering
this to make a spoof test pass, the signals are not separating and that is the finding.

---

## Tuning order

When you see false alerts, in this order:

1. `bufferWindowMs` — absorbs detector noise
2. `absenceEnterRatio` / `presenceRecoverRatio` — widen the band if it flaps
3. `absenceGraceMs` — last resort, and treat it as a smell
4. `minFaceConfidence` — rarely the answer

**A configuration where nothing ever prompts is not a pass.** After every change, re-run
the paired test: a 1-second look-away must produce no prompt, *and* a 5-second exit must
produce one. Only the pair proves the detector still works.
