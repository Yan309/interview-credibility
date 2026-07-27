import type { PresenceConfig } from './config.js';
import type { DetectionSample, PresenceEvent, PresenceState } from './types.js';

/**
 * Turns a stream of noisy per-frame detections into a small number of meaningful
 * presence events.
 *
 * Two mechanisms do the de-noising, and both matter (PRD.md §6.2):
 *
 *   1. A rolling window. Presence is a ratio over `bufferWindowMs`, never a single
 *      frame, so one dropped detection cannot move the state.
 *   2. Hysteresis. The ratio required to *enter* absence is lower than the ratio
 *      required to *recover*. A candidate sitting at the edge of frame therefore
 *      settles into one state instead of oscillating between two.
 *
 * On top of that, `absenceGraceMs` passes silently before the candidate is ever
 * prompted — a brief look away costs them nothing.
 *
 * The machine is pure: it takes samples in and returns events out. No timers, no
 * DOM, no camera. That is what makes Phase 4's tuning work testable in CI.
 */
export class PresenceMachine {
  private state: PresenceState = 'INITIALIZING';
  private buffer: Array<{ at: number; present: boolean }> = [];

  /** When the current ABSENT_PENDING run began. */
  private pendingSince: number | null = null;
  /** When absence was escalated (i.e. when the prompt went up). */
  private absentSince: number | null = null;
  /** When the current qualifying recovery run began, while ABSENT. */
  private recoveringSince: number | null = null;
  /** When multiple faces were first seen in the current run. */
  private multiFaceSince: number | null = null;
  private multiFaceReported = false;

  /** While suspended, absence escalation timers are frozen. See `setSuspended`. */
  private suspended = false;
  private lastSampleAt: number | null = null;
  /** Timestamp of the first sample since (re)initialising — anchors windowIsFull. */
  private firstSampleAt: number | null = null;

  constructor(private readonly config: PresenceConfig) {}

  getState(): PresenceState {
    return this.state;
  }

  /**
   * Milliseconds until `absence:timeout`, or null when no absence is running.
   *
   * The UI must read the countdown from here rather than running its own timer.
   * This clock freezes while suspended, so a parallel timer would keep counting
   * down through a degraded period and end the interview on screen while the
   * machine had not actually escalated.
   */
  getAbsenceRemainingMs(now: number): number | null {
    if (this.state !== 'ABSENT' || this.absentSince === null) return null;
    return Math.max(0, this.config.absenceTimeoutMs - (now - this.absentSince));
  }

  /** Presence ratio over the current window; null until the window has filled. */
  getPresenceRatio(): number | null {
    if (this.buffer.length === 0) return null;
    const present = this.buffer.reduce((n, s) => n + (s.present ? 1 : 0), 0);
    return present / this.buffer.length;
  }

  /**
   * Freeze escalation without losing state — used when the frame is too dark or
   * the tab is throttled. We refuse to escalate an absence we cannot actually
   * verify, because the cost of being wrong is ending someone's interview.
   *
   * Elapsed suspended time is credited back to the pending/absent clocks so a
   * long dark period does not instantly time the candidate out on recovery.
   */
  setSuspended(suspended: boolean, at: number): void {
    if (suspended === this.suspended) return;
    this.suspended = suspended;

    if (!suspended && this.lastSampleAt !== null) {
      const frozenMs = at - this.lastSampleAt;
      if (this.pendingSince !== null) this.pendingSince += frozenMs;
      if (this.absentSince !== null) this.absentSince += frozenMs;
      if (this.recoveringSince !== null) this.recoveringSince += frozenMs;
    }
    this.lastSampleAt = at;
  }

  /** Feed one detector reading. Returns any events it produced, oldest first. */
  ingest(sample: DetectionSample): PresenceEvent[] {
    const events: PresenceEvent[] = [];
    const present = sample.faceCount >= 1 && sample.confidence >= this.config.minFaceConfidence;

    this.buffer.push({ at: sample.at, present });
    this.prune(sample.at);
    this.lastSampleAt = sample.at;
    this.firstSampleAt ??= sample.at;

    events.push(...this.evaluateMultiFace(sample));

    if (this.suspended) return events;

    const ratio = this.getPresenceRatio();
    if (ratio === null) return events;

    switch (this.state) {
      case 'INITIALIZING': {
        // Wait for a full window before committing, so we never open a session
        // with a spurious absence while the camera is still warming up.
        if (!this.windowIsFull(sample.at)) break;
        // Open absent ONLY on a ratio that indicates genuine absence. Using
        // presenceRecoverRatio here instead would open in ABSENT_PENDING for any
        // merely-marginal reading — a candidate sitting in front of a flickering
        // detector would be prompted, and then timed out, while present.
        // Ambiguity at startup resolves toward present; that is the direction
        // where being wrong is cheap.
        this.transition(ratio < this.config.absenceEnterRatio ? 'ABSENT_PENDING' : 'PRESENT', sample.at);
        events.push({ type: 'presence:changed', at: sample.at, present, confidence: sample.confidence });
        break;
      }

      case 'PRESENT': {
        if (ratio < this.config.absenceEnterRatio) {
          this.transition('ABSENT_PENDING', sample.at);
          events.push({ type: 'presence:changed', at: sample.at, present: false, confidence: sample.confidence });
        }
        break;
      }

      case 'ABSENT_PENDING': {
        if (ratio >= this.config.presenceRecoverRatio) {
          // Recovered inside the grace period. The candidate never sees a thing.
          this.transition('PRESENT', sample.at);
          events.push({ type: 'presence:changed', at: sample.at, present: true, confidence: sample.confidence });
          break;
        }
        // Self-healing: if the clock was somehow never started, start it now.
        // The previous `const since = this.pendingSince ?? sample.at` compared
        // each sample against itself, so the grace period could never elapse and
        // the machine hung here permanently.
        this.pendingSince ??= sample.at;
        if (sample.at - this.pendingSince >= this.config.absenceGraceMs) {
          this.absentSince = sample.at;
          this.transition('ABSENT', sample.at);
          events.push({ type: 'absence:started', at: sample.at });
        }
        break;
      }

      case 'ABSENT': {
        if (ratio >= this.config.presenceRecoverRatio) {
          this.recoveringSince ??= sample.at;
          if (sample.at - this.recoveringSince >= this.config.recoveryConfirmMs) {
            const durationMs = sample.at - (this.absentSince ?? sample.at);
            this.absentSince = null;
            this.recoveringSince = null;
            this.transition('PRESENT', sample.at);
            events.push({ type: 'absence:resolved', at: sample.at, durationMs });
            events.push({ type: 'presence:changed', at: sample.at, present: true, confidence: sample.confidence });
          }
          break;
        }

        this.recoveringSince = null;
        const absentSince = this.absentSince ?? sample.at;
        if (sample.at - absentSince >= this.config.absenceTimeoutMs) {
          this.transition('TIMED_OUT', sample.at);
          events.push({ type: 'absence:timeout', at: sample.at, durationMs: sample.at - absentSince });
        }
        break;
      }

      case 'TIMED_OUT':
      case 'CAMERA_ERROR':
        // Terminal. The host app owns what happens next.
        break;
    }

    return events;
  }

  /**
   * Drop stale state after a discontinuity — laptop sleep, tab resume, camera
   * restart. Without this the next sample looks like a multi-minute absence and
   * would time the candidate out for closing their lid.
   */
  reset(at: number): void {
    this.buffer = [];
    this.pendingSince = null;
    this.absentSince = null;
    this.recoveringSince = null;
    this.multiFaceSince = null;
    this.multiFaceReported = false;
    this.lastSampleAt = at;
    // Re-anchor the warm-up window so it re-fills after a discontinuity.
    this.firstSampleAt = null;
    if (this.state !== 'TIMED_OUT' && this.state !== 'CAMERA_ERROR') {
      this.state = 'INITIALIZING';
    }
  }

  markCameraError(): void {
    this.state = 'CAMERA_ERROR';
  }

  private evaluateMultiFace(sample: DetectionSample): PresenceEvent[] {
    if (this.config.multiFacePolicy === 'ignore') return [];

    if (sample.faceCount > 1) {
      this.multiFaceSince ??= sample.at;
      if (!this.multiFaceReported && sample.at - this.multiFaceSince >= this.config.multiFaceGraceMs) {
        this.multiFaceReported = true;
        return [{ type: 'multiface:detected', at: sample.at, faceCount: sample.faceCount }];
      }
      return [];
    }

    this.multiFaceSince = null;
    if (this.multiFaceReported) {
      this.multiFaceReported = false;
      return [{ type: 'multiface:cleared', at: sample.at }];
    }
    return [];
  }

  /**
   * True once we have `bufferWindowMs` of history to judge over.
   *
   * Anchored to the FIRST sample, not the oldest buffered one. The obvious
   * `now - oldest.at >= bufferWindowMs` is a trap: `prune` (same timestamp, runs
   * first) has already dropped everything older than `now - bufferWindowMs`, so
   * the oldest survivor is always younger than the window — the check then only
   * passes on an exact floating-point coincidence where a sample lands at
   * precisely `now - bufferWindowMs`. Whether that ever happens depends on frame
   * timing: at a clean 10fps it lines up, at Android Chrome's ~11fps it never
   * does, and the machine hangs in INITIALIZING forever. Elapsed-since-first is
   * deterministic on every device.
   */
  private windowIsFull(now: number): boolean {
    return this.firstSampleAt !== null && now - this.firstSampleAt >= this.config.bufferWindowMs;
  }

  private prune(now: number): void {
    const cutoff = now - this.config.bufferWindowMs;
    while (this.buffer.length > 0 && this.buffer[0]!.at < cutoff) {
      this.buffer.shift();
    }
  }

  /**
   * Single owner of the grace-period clock.
   *
   * `pendingSince` used to be set by each call site, and the INITIALIZING path
   * forgot to. A session that opened with nobody in frame went straight to
   * ABSENT_PENDING with a null clock and stayed there forever — no prompt, no
   * timeout, silently doing nothing for the whole interview. Starting the clock
   * inside the transition makes that class of omission impossible.
   */
  private transition(next: PresenceState, at: number): void {
    if (next === 'ABSENT_PENDING') {
      if (this.state !== 'ABSENT_PENDING') this.pendingSince = at;
    } else {
      this.pendingSince = null;
    }
    this.state = next;
  }
}
