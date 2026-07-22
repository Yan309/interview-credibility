import type { DetectionSample } from '../../src/core/types.js';

export const FPS = 10;
export const FRAME_MS = 1000 / FPS;

interface RunOptions {
  faceCount?: number;
  confidence?: number;
  luma?: number;
}

/**
 * Build a run of samples of a given duration. Composing these lets a test read
 * like the physical scenario it represents:
 *
 *   present(5000), absent(2000), present(10000)
 */
export function run(durationMs: number, startAt: number, options: RunOptions = {}): DetectionSample[] {
  const { faceCount = 1, confidence = 0.9, luma = 120 } = options;
  const samples: DetectionSample[] = [];
  for (let t = 0; t < durationMs; t += FRAME_MS) {
    samples.push({ at: startAt + t, faceCount, confidence, luma });
  }
  return samples;
}

export function present(durationMs: number, startAt: number): DetectionSample[] {
  return run(durationMs, startAt, { faceCount: 1, confidence: 0.95 });
}

export function absent(durationMs: number, startAt: number): DetectionSample[] {
  return run(durationMs, startAt, { faceCount: 0, confidence: 0 });
}

export function twoFaces(durationMs: number, startAt: number): DetectionSample[] {
  return run(durationMs, startAt, { faceCount: 2, confidence: 0.9 });
}

export function dark(durationMs: number, startAt: number): DetectionSample[] {
  return run(durationMs, startAt, { faceCount: 0, confidence: 0, luma: 12 });
}

/** Concatenate runs, rebasing each onto the end of the previous. */
export function sequence(...builders: Array<(startAt: number) => DetectionSample[]>): DetectionSample[] {
  const out: DetectionSample[] = [];
  let cursor = 0;
  for (const build of builders) {
    const chunk = build(cursor);
    out.push(...chunk);
    cursor = (chunk.at(-1)?.at ?? cursor) + FRAME_MS;
  }
  return out;
}
