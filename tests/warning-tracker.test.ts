import { describe, expect, it } from 'vitest';
import { PresenceRuntime } from '../src/core/runtime.js';
import { WarningTracker } from '../src/core/warning-tracker.js';
import { resolveConfig } from '../src/core/config.js';
import { absent, present, sequence } from './helpers/sequences.js';
import type { PresenceEvent } from '../src/core/types.js';

/**
 * The repeated-absence warning system.
 *
 * Two layers get tested: the tracker in isolation (counting and the exhausted
 * crossing), and the runtime end-to-end (that real leave-and-return cycles
 * produce the right number of strikes).
 */

describe('WarningTracker', () => {
  it('issues a warning per absence and reports the cohort limit', () => {
    const tracker = new WarningTracker(resolveConfig({ cohort: 'panel' })); // limit 3

    const first = tracker.onAbsenceStarted(1000);
    expect(first).toEqual([{ type: 'warning:issued', at: 1000, count: 1, limit: 3, cohort: 'panel' }]);
    expect(tracker.getCount()).toBe(1);

    const second = tracker.onAbsenceStarted(2000);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ type: 'warning:issued', count: 2, limit: 3 });
  });

  it('emits warnings:exhausted exactly once, on reaching the limit', () => {
    const tracker = new WarningTracker(resolveConfig({ cohort: 'panel' })); // limit 3

    tracker.onAbsenceStarted(1000); // 1
    tracker.onAbsenceStarted(2000); // 2
    const third = tracker.onAbsenceStarted(3000); // 3 — the crossing

    expect(third).toEqual([
      { type: 'warning:issued', at: 3000, count: 3, limit: 3, cohort: 'panel' },
      { type: 'warnings:exhausted', at: 3000, count: 3, limit: 3, cohort: 'panel' },
    ]);

    // A fourth absence still warns, but does not re-report exhaustion.
    const fourth = tracker.onAbsenceStarted(4000);
    expect(fourth.some((e) => e.type === 'warnings:exhausted')).toBe(false);
    expect(fourth[0]).toMatchObject({ type: 'warning:issued', count: 4 });
  });

  it('gives different cohorts different tolerances', () => {
    const known = new WarningTracker(resolveConfig({ cohort: 'known' })); // limit 5
    let exhaustedAt = 0;
    for (let i = 1; i <= 5; i += 1) {
      const events = known.onAbsenceStarted(i * 1000);
      if (events.some((e) => e.type === 'warnings:exhausted')) exhaustedAt = i;
    }
    expect(exhaustedAt).toBe(5); // known tolerates 5, not 3
  });

  it('reflects a live cohort change from the config object', () => {
    // The tuning panel mutates the same config object. Switching cohort mid-run
    // must change the limit the tracker enforces, not a value cached at build.
    const config = resolveConfig({ cohort: 'internal' }); // limit 8
    const tracker = new WarningTracker(config);

    tracker.onAbsenceStarted(1000); // count 1, no exhaustion at limit 8
    config.cohort = 'panel'; // limit now 3
    tracker.onAbsenceStarted(2000); // 2
    const third = tracker.onAbsenceStarted(3000); // 3 — exhausts against the new limit

    expect(third.some((e) => e.type === 'warnings:exhausted')).toBe(true);
  });

  it('resets to zero', () => {
    const tracker = new WarningTracker(resolveConfig());
    tracker.onAbsenceStarted(1000);
    tracker.reset();
    expect(tracker.getCount()).toBe(0);
  });
});

describe('warnings through the runtime', () => {
  function drive(samples: Parameters<PresenceRuntime['processSample']>[0][], cohort = 'panel' as const) {
    const events: PresenceEvent[] = [];
    const runtime = new PresenceRuntime({ config: { cohort }, now: () => 0 });
    runtime.on((event) => events.push(event));
    runtime.beginSession(0);
    for (const sample of samples) runtime.processSample(sample);
    return { runtime, events };
  }

  /** One full leave-and-return cycle: present, then absent long enough to escalate, then back. */
  const leaveAndReturn = (startAt: number) =>
    sequence(
      (at) => present(3000, at),
      (at) => absent(6000, at), // > grace (3s), escalates to absence:started
      (at) => present(3000, at), // back before the 30s timeout
    ).map((s) => ({ ...s, at: s.at + startAt }));

  it('counts one warning per leave-and-return cycle', () => {
    const samples = [...leaveAndReturn(0), ...leaveAndReturn(20_000)];
    const { events } = drive(samples);

    const issued = events.filter((e) => e.type === 'warning:issued');
    expect(issued).toHaveLength(2);
    expect(issued[0]).toMatchObject({ count: 1, limit: 3 });
    expect(issued[1]).toMatchObject({ count: 2, limit: 3 });
  });

  it('does not count a brief look-away that never escalates', () => {
    // A 1s dip below the 3s grace period is not a strike — the candidate was
    // never prompted, so nothing should be held against them.
    const samples = sequence(
      (at) => present(3000, at),
      (at) => absent(1000, at), // under grace
      (at) => present(5000, at),
    );
    const { events } = drive(samples);
    expect(events.some((e) => e.type === 'warning:issued')).toBe(false);
  });

  it('records warnings and cohort in the session summary', () => {
    const { runtime } = drive([...leaveAndReturn(0)]);
    const summary = runtime.getSessionSummary();
    expect(summary?.cohort).toBe('panel');
    expect(summary?.warningsIssued).toBe(1);
    expect(summary?.warningsExhausted).toBe(false);
  });
});
