import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/core/config.js';
import { PresenceMachine } from '../src/core/presence-machine.js';
import type { PresenceEvent } from '../src/core/types.js';
import { absent, present, sequence, twoFaces } from './helpers/sequences.js';

function drive(samples: Parameters<PresenceMachine['ingest']>[0][], overrides = {}) {
  const machine = new PresenceMachine(resolveConfig(overrides));
  const events: PresenceEvent[] = [];
  for (const sample of samples) events.push(...machine.ingest(sample));
  return { machine, events, types: events.map((e) => e.type) };
}

describe('PresenceMachine', () => {
  it('settles into PRESENT once the window fills', () => {
    const { machine } = drive(present(5000, 0));
    expect(machine.getState()).toBe('PRESENT');
  });

  it('does not prompt for a brief look-away inside the grace period', () => {
    // 1s away, well under the 3s grace — the candidate should never see anything.
    const samples = sequence(
      (t) => present(6000, t),
      (t) => absent(1000, t),
      (t) => present(6000, t),
    );
    const { types, machine } = drive(samples);

    expect(types).not.toContain('absence:started');
    expect(machine.getState()).toBe('PRESENT');
  });

  it('prompts once absence outlasts the grace period', () => {
    const samples = sequence(
      (t) => present(6000, t),
      (t) => absent(8000, t),
    );
    const { types } = drive(samples);

    expect(types).toContain('absence:started');
    expect(types.filter((t) => t === 'absence:started')).toHaveLength(1);
  });

  it('resolves the absence when the candidate returns', () => {
    const samples = sequence(
      (t) => present(6000, t),
      (t) => absent(8000, t),
      (t) => present(6000, t),
    );
    const { events, types, machine } = drive(samples);

    expect(types).toContain('absence:resolved');
    expect(types).not.toContain('absence:timeout');
    expect(machine.getState()).toBe('PRESENT');

    const resolved = events.find((e) => e.type === 'absence:resolved');
    expect(resolved && 'durationMs' in resolved && resolved.durationMs).toBeGreaterThan(0);
  });

  it('times out exactly once after sustained absence', () => {
    const samples = sequence(
      (t) => present(6000, t),
      (t) => absent(40000, t),
    );
    const { types, machine } = drive(samples);

    expect(types.filter((t) => t === 'absence:timeout')).toHaveLength(1);
    expect(machine.getState()).toBe('TIMED_OUT');
  });

  it('is terminal after timeout', () => {
    const samples = sequence(
      (t) => present(6000, t),
      (t) => absent(40000, t),
      (t) => present(10000, t),
    );
    const { types, machine } = drive(samples);

    expect(machine.getState()).toBe('TIMED_OUT');
    expect(types).not.toContain('absence:resolved');
  });

  it('does not flap when detection alternates at the threshold', () => {
    // Alternating present/absent every 200ms is the pathological detector case
    // that hysteresis exists to absorb.
    const samples: Parameters<PresenceMachine['ingest']>[0][] = [];
    for (let t = 0; t < 20000; t += 100) {
      const flicker = Math.floor(t / 200) % 2 === 0;
      samples.push({ at: t, faceCount: flicker ? 1 : 0, confidence: flicker ? 0.9 : 0, luma: 120 });
    }
    const { types } = drive(samples);

    expect(types).not.toContain('absence:started');
  });

  it('flags a second face only after the grace period', () => {
    const brief = sequence(
      (t) => present(6000, t),
      (t) => twoFaces(2000, t),
      (t) => present(4000, t),
    );
    expect(drive(brief).types).not.toContain('multiface:detected');

    const sustained = sequence(
      (t) => present(6000, t),
      (t) => twoFaces(8000, t),
      (t) => present(4000, t),
    );
    const { types } = drive(sustained);
    expect(types).toContain('multiface:detected');
    expect(types).toContain('multiface:cleared');
  });

  it('keeps presence intact while a second face is in frame', () => {
    const samples = sequence(
      (t) => present(6000, t),
      (t) => twoFaces(8000, t),
    );
    const { machine } = drive(samples);
    expect(machine.getState()).toBe('PRESENT');
  });

  it('does not escalate while suspended', () => {
    const machine = new PresenceMachine(resolveConfig());
    const events: PresenceEvent[] = [];

    for (const sample of present(6000, 0)) events.push(...machine.ingest(sample));
    machine.setSuspended(true, 6000);
    for (const sample of absent(40000, 6000)) events.push(...machine.ingest(sample));

    expect(events.map((e) => e.type)).not.toContain('absence:timeout');
  });

  it('discards stale state on reset so a sleep/resume is not read as absence', () => {
    const machine = new PresenceMachine(resolveConfig());
    for (const sample of present(6000, 0)) machine.ingest(sample);

    machine.reset(600_000); // resumed ten minutes later
    const events: PresenceEvent[] = [];
    for (const sample of present(6000, 600_000)) events.push(...machine.ingest(sample));

    expect(events.map((e) => e.type)).not.toContain('absence:started');
    expect(machine.getState()).toBe('PRESENT');
  });

  it('rejects an inverted hysteresis band at config time', () => {
    expect(() => resolveConfig({ absenceEnterRatio: 0.8, presenceRecoverRatio: 0.3 })).toThrow(
      /presenceRecoverRatio/,
    );
  });
});
