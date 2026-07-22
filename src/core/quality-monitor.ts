import type { PresenceConfig } from './config.js';
import type { DetectionSample, PresenceEvent, QualityReason } from './types.js';

/**
 * Watches whether we are in a position to judge presence at all.
 *
 * The important behaviour is what the PresenceRuntime does with `isDegraded()`:
 * it SUSPENDS absence escalation. If the room is too dark or the tab is throttled,
 * the honest signal is "we can't see you clearly" — not "you left". Treating a dim
 * room as absence would end a legitimate interview, and it would do so unevenly
 * across skin tones, which makes it a fairness bug and not just a lighting bug.
 *
 * TODO(IC-24): confirm luma thresholds against real low-light captures, explicitly
 * including dark skin tones (PRD.md §9).
 */
export class QualityMonitor {
  private candidateReason: QualityReason | null = null;
  private candidateSince: number | null = null;
  private activeReason: QualityReason | null = null;
  private recentTimestamps: number[] = [];

  constructor(private readonly config: PresenceConfig) {}

  isDegraded(): boolean {
    return this.activeReason !== null;
  }

  getReason(): QualityReason | null {
    return this.activeReason;
  }

  ingest(sample: DetectionSample): PresenceEvent[] {
    this.trackFps(sample.at);
    const reason = this.assess(sample);

    if (reason !== null) {
      if (this.candidateReason !== reason) {
        this.candidateReason = reason;
        this.candidateSince = sample.at;
      }
      const since = this.candidateSince ?? sample.at;
      if (this.activeReason !== reason && sample.at - since >= this.config.qualityDebounceMs) {
        this.activeReason = reason;
        return [{ type: 'quality:degraded', at: sample.at, reason }];
      }
      return [];
    }

    this.candidateReason = null;
    this.candidateSince = null;
    if (this.activeReason !== null) {
      this.activeReason = null;
      return [{ type: 'quality:restored', at: sample.at }];
    }
    return [];
  }

  reset(): void {
    this.candidateReason = null;
    this.candidateSince = null;
    this.activeReason = null;
    this.recentTimestamps = [];
  }

  private assess(sample: DetectionSample): QualityReason | null {
    if (this.measuredFps() < this.config.lowFpsThreshold) return 'low-fps';
    if (sample.luma !== undefined && sample.luma < this.config.lowLightLumaThreshold) return 'low-light';
    // TODO(IC-23): occlusion — landmark visibility drop with a face still detected.
    return null;
  }

  private trackFps(now: number): void {
    this.recentTimestamps.push(now);
    const cutoff = now - 1000;
    while (this.recentTimestamps.length > 0 && this.recentTimestamps[0]! < cutoff) {
      this.recentTimestamps.shift();
    }
  }

  private measuredFps(): number {
    // Not enough history to judge; do not report a false low-fps at startup.
    return this.recentTimestamps.length < 3 ? Infinity : this.recentTimestamps.length;
  }
}
