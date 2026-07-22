---
name: tune
description: Run a threshold calibration session against the live camera harness and record the results. For IC-29 (presence hysteresis) and IC-30 (liveness).
disable-model-invocation: true
---

# Tune

Calibration for the tickets that cannot be closed by writing code — IC-29 and IC-30.
Their acceptance criteria are empirical, so this skill produces a recorded result,
not a diff.

`disable-model-invocation` is set because this needs a human physically in front of a
camera. It is never something to start unprompted.

## Before starting

Ask which is being tuned — **presence** (IC-29) or **liveness** (IC-30). They have
different procedures and opposite failure modes, and conflating them wastes a session.

Start the harness with `npm run dev`. The config sliders and the event log are the
instrument; the browser console is not.

## Presence calibration (IC-29)

Target: **zero** `absence:started` events across a 10-minute seated session with
natural movement. That is the M4 gate.

1. Run the natural-movement soak: turning to think, reaching off-desk, drinking,
   adjusting posture. Do not perform stillness — the point is ordinary behaviour.
2. Every false prompt: record the timestamp, what the person was physically doing, and
   the presence ratio at that moment. The ratio is what tells you which knob moved.
3. Adjust in this order — `bufferWindowMs` first, then the hysteresis band
   (`absenceEnterRatio` / `presenceRecoverRatio`), then `absenceGraceMs` last.
   Grace is the crudest fix and the one most likely to mask a real detection problem
   rather than solve it.
4. Re-run the paired test after every change: a 1s look-away must produce no prompt
   **and** a 5s exit must produce one. Tuning until nothing ever prompts is not a pass,
   it is a broken detector.

## Liveness calibration (IC-30)

Target: a live person sitting still for 3 minutes is **not** flagged. Tune the
false-positive rate first and the catch rate second — in that order. A flag on an
honest candidate costs more than a missed photo.

1. Record the still-person baseline first. Establish what a real human's blink count,
   pose variance and micro-motion actually look like at their floor.
2. Only then test the spoofs: held photo, taped photo, phone screen.
3. Set thresholds below the human floor, not above the spoof ceiling. If those two
   overlap, the signal does not separate — say so and do not paper over it by
   loosening `minSignalsToFlag`.
4. A replayed video will not be caught. That is IC-40 and out of scope; note it and
   move on.

## Recording the result

Both paths end the same way:

1. Fill in the relevant rows of [docs/test-matrix.md](../../../docs/test-matrix.md),
   including the failures. A matrix with only passes in it is not evidence.
2. Add a row to its Run log with the date and config snapshot.
3. Write the final values into `DEFAULT_CONFIG` in `src/core/config.ts` **with a
   comment saying how they were derived.** A tuned constant with no provenance is
   indistinguishable from a guess six weeks later.
4. Record anything surprising in [NOTES.md](../../../NOTES.md).

If the gate was not met, say so plainly and leave the ticket In Progress. An
un-met empirical gate reported as done is the one failure mode this whole module
exists to avoid.
