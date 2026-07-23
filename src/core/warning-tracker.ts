import type { PresenceConfig } from './config.js';
import type { PresenceEvent } from './types.js';

/**
 * Counts repeated absences and reports when a cohort's tolerance is used up.
 *
 * The behaviour this exists for: a candidate who steps away and returns over and
 * over. Each individual absence may be innocent, but the pattern is what a
 * reviewer cares about, and different audiences tolerate it differently (a formal
 * panel less than an internal check).
 *
 * Two invariants, both deliberate:
 *
 *   - It counts only ESCALATED absences — an `absence:started`, i.e. a moment the
 *     candidate was actually prompted. A brief look-away that never escalated is
 *     not a strike. This keeps the count aligned with what the candidate saw.
 *   - `warnings:exhausted` is a REPORT, not a termination. Consistent with the
 *     module-wide rule that the host app owns ending the interview.
 *
 * The limit is read live from config on every call rather than cached, so moving
 * the cohort or a limit in the tuning panel takes effect immediately.
 */
export class WarningTracker {
  private count = 0;

  constructor(private readonly config: PresenceConfig) {}

  private get limit(): number {
    return this.config.warningLimits[this.config.cohort];
  }

  getCount(): number {
    return this.count;
  }

  /** Call once per `absence:started`. Returns the warning events it produced. */
  onAbsenceStarted(at: number): PresenceEvent[] {
    const limit = this.limit;
    const cohort = this.config.cohort;

    const wasBelow = this.count < limit;
    this.count += 1;
    const nowAtOrAbove = this.count >= limit;

    const events: PresenceEvent[] = [
      { type: 'warning:issued', at, count: this.count, limit, cohort },
    ];

    // Fire exhausted exactly once, on the crossing. If the limit is lowered
    // mid-session below an already-past count, we do not re-fire — the host has
    // already been told, and a second report adds nothing.
    if (wasBelow && nowAtOrAbove) {
      events.push({ type: 'warnings:exhausted', at, count: this.count, limit, cohort });
    }
    return events;
  }

  /** New session. Warnings do NOT reset on a discontinuity (lid close); only here. */
  reset(): void {
    this.count = 0;
  }
}
