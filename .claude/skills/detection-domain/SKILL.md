---
name: detection-domain
description: Domain knowledge for face-presence detection — what each threshold means, how MediaPipe FaceLandmarker outputs map to our signals, and which failure modes are dangerous. Load when editing src/core detection logic, thresholds, or the state machine.
user-invocable: false
---

# Detection domain notes

Background knowledge for working in `src/core`. `user-invocable: false` because this
is reference material, not an action — there is nothing useful for a human to "run".

## What the presence knobs actually control

- **`minFaceConfidence`** — per-frame gate on the detector score. Raising it does not
  make detection stricter in a useful way; it mostly converts masked and poorly-lit
  candidates into false absences. Prefer tuning the window, not this.
- **`bufferWindowMs`** — how much history the ratio sees. Longer absorbs more noise but
  adds latency to genuine absence. This is the first knob to reach for.
- **`absenceEnterRatio` / `presenceRecoverRatio`** — the hysteresis band. The gap
  between them is what stops flapping. Narrowing the gap to "make it more responsive"
  reintroduces the exact oscillation the band exists to prevent.
- **`absenceGraceMs`** — silent time before the candidate is prompted. The bluntest
  instrument here. If raising grace fixes a false-alert problem, the detection layer
  probably still has the problem and grace is only hiding it.

## MediaPipe FaceLandmarker → our signals

One `detectForVideo` call yields everything:

- **Presence** — `faceLandmarks.length` and the detection score.
- **Blink** — `faceBlendshapes`, categories `eyeBlinkLeft` / `eyeBlinkRight`. Requires
  `outputFaceBlendshapes: true`.
- **Head pose** — `facialTransformationMatrixes`, a 4×4; yaw/pitch/roll come from the
  rotation submatrix. Requires `outputFacialTransformationMatrixes: true`.
- **Micro-motion** — mean absolute landmark displacement between consecutive frames,
  normalised by face bounding-box size so it is scale-invariant. Without that
  normalisation, sitting closer to the camera reads as "more alive."

`numFaces` must be > 1 or a second person is invisible — the model returns at most
`numFaces` results, so multi-face detection silently never fires if it is left at 1.

Timestamps passed to `detectForVideo` must increase monotonically. Feeding a
non-increasing timestamp throws rather than returning a result.

## Failure modes, ranked by cost

1. **False absence on a present candidate** — ends a legitimate interview. Worst
   outcome the module can produce. Every ambiguity resolves toward "present."
2. **False liveness flag** — accuses an honest person. Advisory-only and the
   two-signal rule exist to make this rare.
3. **Uneven failure across skin tones** — false absence that lands disproportionately
   on some candidates. Treated as a fairness constraint, not a lighting bug: low light
   must produce `quality:degraded`, never `absence:started`.
4. **Missed spoof** — cheapest failure. A missed photo costs far less than any of the
   above, which is why liveness never terminates.

## Things that look like bugs but are not

- Presence surviving a second face in frame. Deliberate — multi-face is a separate
  advisory signal, not an absence.
- Liveness not firing on a replayed video. Known, accepted, documented as IC-40.
- The state machine staying `TIMED_OUT` after the candidate returns. Terminal by
  design; the host app decides what happens after a timeout.
- `resolveConfig` throwing on an inverted hysteresis band. That check is load-bearing —
  the failure it prevents presents as "the detector is flaky."
