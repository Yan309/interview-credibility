import type { LivenessConfig } from './config.js';
import type { DetectionSample, LivenessSignal, PresenceEvent } from './types.js';

/**
 * Scores whether the face in frame shows signs of life.
 *
 * Design constraints, both non-negotiable (PRD.md §6.3):
 *
 *   - ADVISORY ONLY. This never ends a session and never produces accusatory copy
 *     for the candidate. It raises a flag a human can look at.
 *   - TWO SIGNALS MINIMUM. A single dead signal is not enough. People do sit very
 *     still, and the metric that matters here is the false-positive rate on an
 *     honest candidate, not the catch rate on a photo.
 *
 * Known and accepted gap: passive liveness does not defeat a replayed video of
 * the candidate. Challenge-response would, and is deliberately out of scope.
 *
 * TODO(IC-30): calibrate thresholds against recorded clips before trusting these.
 */
export class LivenessScorer {
  private blinkTimestamps: number[] = [];
  private eyesClosed = false;
  private lastBlinkAt = -Infinity;
  private poseWindow: Array<{ at: number; yaw: number; pitch: number; roll: number }> = [];
  private motionWindow: Array<{ at: number; motion: number }> = [];
  private windowStartedAt: number | null = null;
  private flagged = false;

  constructor(private readonly config: LivenessConfig) {}

  isFlagged(): boolean {
    return this.flagged;
  }

  /** Call only while a face is actually present; absence is not a liveness signal. */
  ingest(sample: DetectionSample): PresenceEvent[] {
    if (!this.config.enabled) return [];

    this.windowStartedAt ??= sample.at;
    this.trackBlink(sample);
    this.trackPose(sample);
    this.trackMotion(sample);
    this.prune(sample.at);

    // Only judge on a full window. Judging early is how you flag someone for
    // happening not to blink during their first two seconds on camera.
    if (sample.at - this.windowStartedAt < this.config.windowMs) return [];

    const dead = this.deadSignals();
    const shouldFlag = dead.length >= this.config.minSignalsToFlag;

    if (shouldFlag && !this.flagged) {
      this.flagged = true;
      return [{ type: 'liveness:suspect', at: sample.at, signals: dead }];
    }
    if (!shouldFlag && this.flagged) {
      this.flagged = false;
      return [{ type: 'liveness:cleared', at: sample.at }];
    }
    return [];
  }

  reset(): void {
    this.blinkTimestamps = [];
    this.poseWindow = [];
    this.motionWindow = [];
    this.windowStartedAt = null;
    this.eyesClosed = false;
    this.lastBlinkAt = -Infinity;
    this.flagged = false;
  }

  private deadSignals(): LivenessSignal[] {
    const dead: LivenessSignal[] = [];
    if (this.blinkTimestamps.length < this.config.minBlinksPerWindow) dead.push('blink');
    if (this.poseVariance() < this.config.minPoseVariance) dead.push('head-pose');
    if (this.meanMotion() < this.config.minMotion) dead.push('micro-motion');
    return dead;
  }

  /** Edge-triggered with a refractory period, so one blink counts once. */
  private trackBlink(sample: DetectionSample): void {
    if (!sample.blink) return;
    const closed =
      sample.blink.left >= this.config.blinkThreshold && sample.blink.right >= this.config.blinkThreshold;

    if (closed && !this.eyesClosed) {
      if (sample.at - this.lastBlinkAt >= this.config.blinkRefractoryMs) {
        this.blinkTimestamps.push(sample.at);
        this.lastBlinkAt = sample.at;
      }
    }
    this.eyesClosed = closed;
  }

  private trackPose(sample: DetectionSample): void {
    if (!sample.pose) return;
    this.poseWindow.push({ at: sample.at, ...sample.pose });
  }

  private trackMotion(sample: DetectionSample): void {
    if (sample.motion === undefined) return;
    this.motionWindow.push({ at: sample.at, motion: sample.motion });
  }

  /** Summed variance across the three rotation axes, in deg^2. */
  private poseVariance(): number {
    if (this.poseWindow.length < 2) return Infinity; // not enough data — do not accuse
    const axes = ['yaw', 'pitch', 'roll'] as const;
    return axes.reduce((total, axis) => total + variance(this.poseWindow.map((p) => p[axis])), 0);
  }

  private meanMotion(): number {
    if (this.motionWindow.length === 0) return Infinity;
    return this.motionWindow.reduce((n, m) => n + m.motion, 0) / this.motionWindow.length;
  }

  private prune(now: number): void {
    const cutoff = now - this.config.windowMs;
    this.blinkTimestamps = this.blinkTimestamps.filter((t) => t >= cutoff);
    this.poseWindow = this.poseWindow.filter((p) => p.at >= cutoff);
    this.motionWindow = this.motionWindow.filter((m) => m.at >= cutoff);
  }
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
}
