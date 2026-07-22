import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { LivenessScorer } from '../src/core/liveness-scorer.js';
import type { DetectionSample, PresenceEvent } from '../src/core/types.js';
import { FRAME_MS } from './helpers/sequences.js';

const WINDOW = DEFAULT_CONFIG.liveness.windowMs;

/** A live person: blinks periodically, head drifts, landmarks move. */
function livePerson(durationMs: number): DetectionSample[] {
  const samples: DetectionSample[] = [];
  for (let t = 0; t < durationMs; t += FRAME_MS) {
    const blinking = t % 4000 < FRAME_MS * 2; // ~15 blinks/min
    samples.push({
      at: t,
      faceCount: 1,
      confidence: 0.95,
      blink: { left: blinking ? 0.8 : 0.05, right: blinking ? 0.8 : 0.05 },
      pose: { yaw: Math.sin(t / 900) * 4, pitch: Math.cos(t / 1300) * 3, roll: Math.sin(t / 1700) * 2 },
      motion: 0.006,
    });
  }
  return samples;
}

/** A live person holding unusually still — the false-positive case that matters. */
function veryStillPerson(durationMs: number): DetectionSample[] {
  const samples: DetectionSample[] = [];
  for (let t = 0; t < durationMs; t += FRAME_MS) {
    const blinking = t % 6000 < FRAME_MS * 2; // slow blinker
    samples.push({
      at: t,
      faceCount: 1,
      confidence: 0.95,
      blink: { left: blinking ? 0.75 : 0.03, right: blinking ? 0.75 : 0.03 },
      pose: { yaw: Math.sin(t / 2000) * 1.2, pitch: 0.4, roll: 0.2 },
      motion: 0.003,
    });
  }
  return samples;
}

/** A photo taped in front of the lens: no blink, no pose change, no motion. */
function staticPhoto(durationMs: number): DetectionSample[] {
  const samples: DetectionSample[] = [];
  for (let t = 0; t < durationMs; t += FRAME_MS) {
    samples.push({
      at: t,
      faceCount: 1,
      confidence: 0.92,
      blink: { left: 0.02, right: 0.02 },
      pose: { yaw: 3, pitch: 1, roll: 0 },
      motion: 0.00001,
    });
  }
  return samples;
}

function score(samples: DetectionSample[]) {
  const scorer = new LivenessScorer(DEFAULT_CONFIG.liveness);
  const events: PresenceEvent[] = [];
  for (const sample of samples) events.push(...scorer.ingest(sample));
  return { scorer, events, types: events.map((e) => e.type) };
}

describe('LivenessScorer', () => {
  it('flags a static photo within two windows', () => {
    const { types } = score(staticPhoto(WINDOW * 2));
    expect(types).toContain('liveness:suspect');
  });

  it('does not flag a normal live person', () => {
    const { types } = score(livePerson(WINDOW * 3));
    expect(types).not.toContain('liveness:suspect');
  });

  it('does not flag a live person sitting very still for three minutes', () => {
    // This is the metric that actually matters. A false flag here erodes trust
    // with an honest candidate, which costs more than missing a photo.
    const { types } = score(veryStillPerson(180_000));
    expect(types).not.toContain('liveness:suspect');
  });

  it('never judges before a full window has elapsed', () => {
    const { types } = score(staticPhoto(WINDOW - 1000));
    expect(types).toHaveLength(0);
  });

  it('requires two dead signals, not one', () => {
    // Blinking normally and head moving normally, but micro-motion reads dead —
    // e.g. a landmark-displacement metric that under-reports. Exactly one dead
    // signal, so this must NOT flag. A single flaky metric cannot accuse anyone.
    const samples: DetectionSample[] = [];
    for (let t = 0; t < WINDOW * 2; t += FRAME_MS) {
      const blinking = t % 4000 < FRAME_MS * 2;
      samples.push({
        at: t,
        faceCount: 1,
        confidence: 0.9,
        blink: { left: blinking ? 0.8 : 0.02, right: blinking ? 0.8 : 0.02 },
        pose: { yaw: Math.sin(t / 900) * 4, pitch: Math.cos(t / 1300) * 3, roll: 0 },
        motion: 0.00001,
      });
    }
    const { types } = score(samples);
    expect(types).not.toContain('liveness:suspect');
  });

  it('clears the flag when signals recover', () => {
    const samples = [
      ...staticPhoto(WINDOW * 2),
      ...livePerson(WINDOW * 2).map((s) => ({ ...s, at: s.at + WINDOW * 2 })),
    ];
    const { types } = score(samples);
    expect(types).toContain('liveness:suspect');
    expect(types).toContain('liveness:cleared');
  });

  it('counts one blink once despite multiple closed frames', () => {
    const samples: DetectionSample[] = [];
    for (let t = 0; t < WINDOW + 1000; t += FRAME_MS) {
      const blinking = t >= 1000 && t < 1000 + FRAME_MS * 4; // one long blink
      samples.push({
        at: t,
        faceCount: 1,
        confidence: 0.9,
        blink: { left: blinking ? 0.9 : 0.02, right: blinking ? 0.9 : 0.02 },
        pose: { yaw: 0, pitch: 0, roll: 0 },
        motion: 0.00001,
      });
    }
    // One blink is below minBlinksPerWindow (2), so blink + pose + motion are all
    // dead and the flag fires. If the blink were double-counted it would not.
    const { types } = score(samples);
    expect(types).toContain('liveness:suspect');
  });
});
