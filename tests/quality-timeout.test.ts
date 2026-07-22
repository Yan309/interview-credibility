import { describe, expect, it } from 'vitest';
import { PresenceRuntime } from '../src/core/runtime.js';
import type { DetectionSample, PresenceEvent } from '../src/core/types.js';

/**
 * The lighting-recovery clock (`quality:timeout`).
 *
 * This is the one escalation path that can end a session for a reason outside
 * the candidate's control, so its guard conditions get pinned down hard. The
 * decisive rule is the second test: a detectable face resets the clock, no
 * matter how dark the frame is.
 */

function makeRuntime(overrides = {}) {
  const events: PresenceEvent[] = [];
  const runtime = new PresenceRuntime({
    config: { lightingTimeoutMs: 10_000, qualityDebounceMs: 1000, ...overrides },
    now: () => 0,
  });
  runtime.on((event) => events.push(event));
  runtime.beginSession(0);
  return { runtime, events };
}

/** Feed samples at 100ms intervals from `from` to `to`. */
function feed(
  runtime: PresenceRuntime,
  from: number,
  to: number,
  build: (at: number) => Omit<DetectionSample, 'at'>,
): void {
  for (let at = from; at <= to; at += 100) {
    runtime.processSample({ at, ...build(at) });
  }
}

const dark = { faceCount: 0, confidence: 0, luma: 5 };
const darkButVisible = { faceCount: 1, confidence: 1, luma: 5 };
const bright = { faceCount: 1, confidence: 1, luma: 140 };

describe('quality:timeout', () => {
  it('fires when the frame stays unusable and no face is detectable', () => {
    const { runtime, events } = makeRuntime();
    feed(runtime, 0, 15_000, () => dark);

    const timeout = events.find((e) => e.type === 'quality:timeout');
    expect(timeout).toBeDefined();
    expect(timeout).toMatchObject({ reason: 'low-light' });
  });

  it('does NOT fire while a face is still detectable, however dark the frame', () => {
    // The fairness guard. Poor lighting alone must never end a session: if the
    // candidate is demonstrably visible, there is nothing to escalate. Camera
    // quality varies with equipment and skin tone, and neither is a candidate's
    // fault.
    const { runtime, events } = makeRuntime();
    feed(runtime, 0, 30_000, () => darkButVisible);

    expect(events.some((e) => e.type === 'quality:timeout')).toBe(false);
  });

  it('fires only once, not on every subsequent sample', () => {
    const { runtime, events } = makeRuntime();
    feed(runtime, 0, 25_000, () => dark);

    expect(events.filter((e) => e.type === 'quality:timeout')).toHaveLength(1);
  });

  it('resets the clock when conditions recover', () => {
    const { runtime, events } = makeRuntime();
    feed(runtime, 0, 8000, () => dark); // not yet at the 10s limit
    feed(runtime, 8100, 12_000, () => bright); // recovered
    feed(runtime, 12_100, 20_000, () => dark); // dark again, but < 10s

    expect(events.some((e) => e.type === 'quality:timeout')).toBe(false);
  });

  it('reports remaining time that decreases and never goes negative', () => {
    const { runtime } = makeRuntime();
    feed(runtime, 0, 3000, () => dark);
    const early = runtime.getQualityRemainingMs(3000);

    feed(runtime, 3100, 6000, () => dark);
    const later = runtime.getQualityRemainingMs(6000);

    expect(early).not.toBeNull();
    expect(later).not.toBeNull();
    expect(later!).toBeLessThan(early!);
    expect(later!).toBeGreaterThanOrEqual(0);
  });

  it('records a quality timeout distinctly from an absence timeout', () => {
    // A reviewer must be able to tell "the room was too dark" apart from "the
    // candidate left". Collapsing them would misrepresent the candidate.
    const { runtime } = makeRuntime();
    feed(runtime, 0, 15_000, () => dark);

    const summary = runtime.getSessionSummary();
    expect(summary?.qualityTimedOut).toBe(true);
    expect(summary?.timedOut).toBe(false);
  });
});
