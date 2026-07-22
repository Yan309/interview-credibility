import { describe, expect, it } from 'vitest';
import { PresenceMachine } from '../src/core/presence-machine.js';
import { resolveConfig } from '../src/core/config.js';
import { absent, present, sequence } from './helpers/sequences.js';
import type { PresenceEvent } from '../src/core/types.js';

/**
 * Regression: a session that OPENS with nobody in frame.
 *
 * The machine went INITIALIZING → ABSENT_PENDING without starting the grace
 * clock, then compared each sample's timestamp against itself — so the grace
 * period never elapsed and it sat in ABSENT_PENDING for the entire interview.
 * No prompt, no timeout, no error: it silently did nothing.
 *
 * The path mattered because it is a normal way to start. A candidate who joins
 * early and steps away, or whose camera takes a moment to focus, opens the
 * session absent. Everything downstream — prompt, countdown, timeout — was dead.
 */

function drive(samples: ReturnType<typeof absent>, config = resolveConfig()): PresenceEvent[] {
  const machine = new PresenceMachine(config);
  const events: PresenceEvent[] = [];
  for (const sample of samples) events.push(...machine.ingest(sample));
  return events;
}

describe('a session that starts absent', () => {
  it('prompts after the grace period', () => {
    // 10s of nobody in frame, against a 3s grace period.
    const events = drive(absent(10_000, 0));

    const started = events.find((e) => e.type === 'absence:started');
    expect(started, 'absence:started never fired from a cold start').toBeDefined();
    // Full window (2s) then grace (3s).
    expect(started!.at).toBeGreaterThanOrEqual(5000);
    expect(started!.at).toBeLessThan(6000);
  });

  it('reaches absence:timeout, rather than hanging in ABSENT_PENDING', () => {
    const machine = new PresenceMachine(resolveConfig());
    const events: PresenceEvent[] = [];
    for (const sample of absent(45_000, 0)) events.push(...machine.ingest(sample));

    expect(events.filter((e) => e.type === 'absence:timeout')).toHaveLength(1);
    expect(machine.getState()).toBe('TIMED_OUT');
  });

  it('exposes a countdown that actually decreases', () => {
    // The countdown reads from getAbsenceRemainingMs. If the machine never
    // escalates, this stays null and the UI shows a frozen timer — which is what
    // the bug looked like from the outside.
    const machine = new PresenceMachine(resolveConfig());
    for (const sample of absent(8000, 0)) machine.ingest(sample);

    const early = machine.getAbsenceRemainingMs(8000);
    const later = machine.getAbsenceRemainingMs(12_000);

    expect(early).not.toBeNull();
    expect(later!).toBeLessThan(early!);
  });

  it('still honours the grace period — arriving during it produces no prompt', () => {
    // The fix must not turn a cold start into an instant accusation. Someone
    // sitting down two seconds after the session opens should see nothing.
    const events = drive(
      sequence(
        (at) => absent(2500, at), // window fills, enters ABSENT_PENDING
        (at) => present(20_000, at), // arrives inside the 3s grace
      ),
    );

    expect(events.some((e) => e.type === 'absence:started')).toBe(false);
  });

  it('starts present when someone is already there', () => {
    const machine = new PresenceMachine(resolveConfig());
    for (const sample of present(6000, 0)) machine.ingest(sample);

    expect(machine.getState()).toBe('PRESENT');
  });
});
