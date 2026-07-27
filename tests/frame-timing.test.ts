import { describe, expect, it } from 'vitest';
import { PresenceMachine } from '../src/core/presence-machine.js';
import { resolveConfig } from '../src/core/config.js';
import type { PresenceEvent } from '../src/core/types.js';

/**
 * Regression: the machine must leave INITIALIZING regardless of frame spacing.
 *
 * The original `windowIsFull` compared `now - oldest.at >= bufferWindowMs` right
 * after pruning everything older than `now - bufferWindowMs`, so it only passed
 * when a sample landed at *exactly* `now - bufferWindowMs`. At a clean 10fps
 * (100ms, a divisor of the 2000ms window) that coincidence happens; at Android
 * Chrome's real ~11fps it never does, and the machine hung in INITIALIZING for
 * minutes while detection ran perfectly. These feed deliberately un-aligned
 * spacings that would all have hung under the old logic.
 */

function feedAtSpacing(spacingMs: number, durationMs: number, startAt = 0) {
  const machine = new PresenceMachine(resolveConfig());
  const events: PresenceEvent[] = [];
  // Face present the whole time, so the expected exit is INITIALIZING → PRESENT.
  for (let at = startAt; at <= startAt + durationMs; at += spacingMs) {
    events.push(...machine.ingest({ at, faceCount: 1, confidence: 0.95, luma: 120 }));
  }
  return { machine, events };
}

describe('INITIALIZING exit is independent of frame spacing', () => {
  // 90.9ms ≈ 11fps (the Android case), plus other non-divisors of 2000ms.
  for (const spacing of [90.9, 83.3, 91, 97, 111, 133]) {
    it(`leaves INITIALIZING at ~${spacing}ms spacing`, () => {
      const { machine, events } = feedAtSpacing(spacing, 5000);
      expect(machine.getState()).toBe('PRESENT');
      expect(events.some((e) => e.type === 'presence:changed' && e.present)).toBe(true);
    });
  }

  it('transitions within a frame of bufferWindowMs, not seconds later', () => {
    // The old bug made desktop wait 6-7s (for a lucky float alignment) when it
    // should be ~2s. Pin that: the first presence event lands within one frame
    // of the 2000ms window.
    const { events } = feedAtSpacing(90.9, 4000);
    const first = events.find((e) => e.type === 'presence:changed');
    expect(first).toBeDefined();
    expect(first!.at).toBeGreaterThanOrEqual(2000);
    expect(first!.at).toBeLessThan(2000 + 100);
  });

  it('re-fills the window after a discontinuity reset', () => {
    const machine = new PresenceMachine(resolveConfig());
    for (let at = 0; at <= 3000; at += 91) {
      machine.ingest({ at, faceCount: 1, confidence: 0.95, luma: 120 });
    }
    expect(machine.getState()).toBe('PRESENT');

    // Simulate a lid-close gap, then confirm it re-warms rather than judging early.
    machine.reset(100000);
    machine.ingest({ at: 100000, faceCount: 1, confidence: 0.95, luma: 120 });
    expect(machine.getState()).toBe('INITIALIZING');
    for (let at = 100091; at <= 102500; at += 91) {
      machine.ingest({ at, faceCount: 1, confidence: 0.95, luma: 120 });
    }
    expect(machine.getState()).toBe('PRESENT');
  });
});
