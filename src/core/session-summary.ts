import type { ConsumerCohort, PresenceEvent, QualityReason, SessionSummary } from './types.js';

/**
 * Accumulates the post-interview integrity record — the thing a reviewer reads
 * instead of watching footage.
 *
 * Scalars and timestamps only. Nothing here can reconstruct a frame.
 */
export class SessionSummaryBuilder {
  private startedAt: number;
  private endedAt: number | null = null;
  private absenceCount = 0;
  private cumulativeAbsentMs = 0;
  private longestAbsenceMs = 0;
  private timedOut = false;
  private qualityTimedOut = false;
  private multiFaceOccurrences = 0;
  private livenessFlags = 0;
  private degradedPeriods: Array<{ reason: QualityReason; durationMs: number }> = [];
  private degradedSince: { reason: QualityReason; at: number } | null = null;
  private warningsIssued = 0;
  private warningsExhausted = false;
  private cohort: ConsumerCohort;

  constructor(startedAt: number, cohort: ConsumerCohort) {
    this.startedAt = startedAt;
    this.cohort = cohort;
  }

  record(event: PresenceEvent): void {
    switch (event.type) {
      case 'absence:started':
        this.absenceCount += 1;
        break;
      case 'absence:resolved':
      case 'absence:timeout':
        this.cumulativeAbsentMs += event.durationMs;
        this.longestAbsenceMs = Math.max(this.longestAbsenceMs, event.durationMs);
        if (event.type === 'absence:timeout') this.timedOut = true;
        break;
      case 'multiface:detected':
        this.multiFaceOccurrences += 1;
        break;
      case 'liveness:suspect':
        this.livenessFlags += 1;
        break;
      case 'warning:issued':
        this.warningsIssued += 1;
        break;
      case 'warnings:exhausted':
        this.warningsExhausted = true;
        break;
      case 'quality:degraded':
        this.degradedSince = { reason: event.reason, at: event.at };
        break;
      case 'quality:timeout':
        this.qualityTimedOut = true;
        this.degradedPeriods.push({ reason: event.reason, durationMs: event.durationMs });
        this.degradedSince = null;
        break;
      case 'quality:restored':
        if (this.degradedSince) {
          this.degradedPeriods.push({
            reason: this.degradedSince.reason,
            durationMs: event.at - this.degradedSince.at,
          });
          this.degradedSince = null;
        }
        break;
      case 'session:stopped':
        this.endedAt = event.at;
        break;
      default:
        break;
    }
  }

  build(now: number): SessionSummary {
    return {
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      totalDurationMs: (this.endedAt ?? now) - this.startedAt,
      absenceCount: this.absenceCount,
      cumulativeAbsentMs: this.cumulativeAbsentMs,
      longestAbsenceMs: this.longestAbsenceMs,
      timedOut: this.timedOut,
      qualityTimedOut: this.qualityTimedOut,
      multiFaceOccurrences: this.multiFaceOccurrences,
      livenessFlags: this.livenessFlags,
      degradedPeriods: [...this.degradedPeriods],
      cohort: this.cohort,
      warningsIssued: this.warningsIssued,
      warningsExhausted: this.warningsExhausted,
    };
  }
}
