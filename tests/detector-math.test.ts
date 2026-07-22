import { describe, expect, it } from 'vitest';
import { boundingBoxScale, readPose } from '../src/core/detector.js';

/**
 * The pure maths inside the detector. Camera-free, and the column-major reading
 * of the transformation matrix is exactly the kind of thing that produces
 * plausible-but-wrong numbers if it is silently transposed.
 */

/** Build a column-major 4x4 from a row-major rotation, the way MediaPipe ships it. */
function matrixFromRows(rows: number[][]): { rows: number; columns: number; data: number[] } {
  const data = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      data[c * 4 + r] = rows[r]?.[c] ?? (r === c ? 1 : 0);
    }
  }
  return { rows: 4, columns: 4, data };
}

const identity = matrixFromRows([
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
]);

describe('readPose', () => {
  it('reads zero rotation from the identity matrix', () => {
    const pose = readPose(identity);
    expect(pose).not.toBeNull();
    expect(pose!.yaw).toBeCloseTo(0, 5);
    expect(pose!.pitch).toBeCloseTo(0, 5);
    expect(pose!.roll).toBeCloseTo(0, 5);
  });

  it('reads a yaw-only rotation without leaking into pitch or roll', () => {
    // 30 degrees about Z in this convention.
    const a = (30 * Math.PI) / 180;
    const pose = readPose(
      matrixFromRows([
        [Math.cos(a), -Math.sin(a), 0, 0],
        [Math.sin(a), Math.cos(a), 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ]),
    );
    expect(pose!.yaw).toBeCloseTo(30, 4);
    expect(pose!.pitch).toBeCloseTo(0, 4);
    expect(pose!.roll).toBeCloseTo(0, 4);
  });

  it('reads a pitch-only rotation', () => {
    const a = (20 * Math.PI) / 180;
    const pose = readPose(
      matrixFromRows([
        [Math.cos(a), 0, Math.sin(a), 0],
        [0, 1, 0, 0],
        [-Math.sin(a), 0, Math.cos(a), 0],
        [0, 0, 0, 1],
      ]),
    );
    expect(pose!.pitch).toBeCloseTo(20, 4);
    expect(pose!.yaw).toBeCloseTo(0, 4);
  });

  it('survives gimbal lock instead of returning NaN', () => {
    // A NaN here would poison the pose variance and silently disable the
    // head-pose liveness signal rather than failing loudly.
    const pose = readPose(
      matrixFromRows([
        [0, 0, 1, 0],
        [0, 1, 0, 0],
        [-1, 0, 0, 0],
        [0, 0, 0, 1],
      ]),
    );
    expect(pose).not.toBeNull();
    expect(Number.isNaN(pose!.yaw)).toBe(false);
    expect(Number.isNaN(pose!.pitch)).toBe(false);
    expect(Number.isNaN(pose!.roll)).toBe(false);
    expect(pose!.pitch).toBeCloseTo(90, 3);
  });

  it('returns null rather than guessing when the matrix is absent or short', () => {
    expect(readPose(undefined)).toBeNull();
    expect(readPose({ rows: 2, columns: 2, data: [1, 0, 0, 1] })).toBeNull();
  });
});

describe('boundingBoxScale', () => {
  it('measures the diagonal of the landmark bounding box', () => {
    const scale = boundingBoxScale([
      { x: 0.4, y: 0.4 },
      { x: 0.7, y: 0.8 },
    ]);
    expect(scale).toBeCloseTo(0.5, 6); // 3-4-5
  });

  it('scales with apparent face size', () => {
    const near = boundingBoxScale([
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.8 },
    ]);
    const far = boundingBoxScale([
      { x: 0.45, y: 0.45 },
      { x: 0.55, y: 0.55 },
    ]);
    // This ratio is what stops "sitting closer to the camera" from reading as
    // "more alive" once displacement is divided through by it.
    expect(near).toBeGreaterThan(far * 5);
  });

  it('returns 0 for an empty landmark set', () => {
    expect(boundingBoxScale([])).toBe(0);
  });
});
