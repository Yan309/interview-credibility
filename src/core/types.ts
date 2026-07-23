/**
 * Public types for the presence module.
 *
 * PRIVACY INVARIANT: nothing in this file may carry image data, landmark
 * coordinates, or anything else from which a frame could be reconstructed.
 * Events are scalars and timestamps only. See PRD.md §6.5.
 */

export type PresenceState =
  | 'INITIALIZING'
  | 'PRESENT'
  | 'ABSENT_PENDING'
  | 'ABSENT'
  | 'TIMED_OUT'
  | 'CAMERA_ERROR';

export type QualityReason = 'low-light' | 'occluded' | 'low-fps';

export type CameraErrorReason =
  | 'permission-denied'
  | 'no-device'
  | 'device-busy'
  | 'track-ended'
  | 'unsupported';

export type LivenessSignal = 'blink' | 'head-pose' | 'micro-motion';

/**
 * Consumer cohort. Different interview audiences get different tolerance for
 * repeated absences — a formal panel is held to a stricter standard than an
 * internal check. Drives the warning limit; see `warningLimits` in config.
 */
export type ConsumerCohort = 'panel' | 'known' | 'internal';

export type PresenceEvent =
  | { type: 'session:started'; at: number }
  | { type: 'session:stopped'; at: number }
  | { type: 'presence:changed'; at: number; present: boolean; confidence: number }
  | { type: 'absence:started'; at: number }
  | { type: 'absence:resolved'; at: number; durationMs: number }
  | { type: 'absence:timeout'; at: number; durationMs: number }
  | { type: 'multiface:detected'; at: number; faceCount: number }
  | { type: 'multiface:cleared'; at: number }
  | { type: 'liveness:suspect'; at: number; signals: LivenessSignal[] }
  | { type: 'liveness:cleared'; at: number }
  | { type: 'quality:degraded'; at: number; reason: QualityReason }
  | { type: 'quality:restored'; at: number }
  /**
   * Quality stayed unusable past `lightingTimeoutMs` with no detectable face.
   * Like `absence:timeout` this is a REPORT — the host app ends the session.
   */
  | { type: 'quality:timeout'; at: number; reason: QualityReason; durationMs: number }
  /**
   * A repeated absence was counted. Advisory — `count` of `limit` used. The host
   * app can surface "warning 2 of 3" without deciding anything.
   */
  | { type: 'warning:issued'; at: number; count: number; limit: number; cohort: ConsumerCohort }
  /**
   * The cohort's warning limit has been reached. Like `absence:timeout`, this is a
   * REPORT — the host app decides whether repeated absences end the interview.
   */
  | { type: 'warnings:exhausted'; at: number; count: number; limit: number; cohort: ConsumerCohort }
  | { type: 'camera:error'; at: number; reason: CameraErrorReason };

export type PresenceEventType = PresenceEvent['type'];

/**
 * One detector reading. This is the only thing the state machine consumes, which
 * is what lets it be tested without a camera or a model.
 */
export interface DetectionSample {
  /** Monotonic timestamp in ms. */
  at: number;
  faceCount: number;
  /** Confidence of the primary (largest) face; 0 when no face is found. */
  confidence: number;
  /** Mean luma 0-255 of the sampled frame, for the quality monitor. */
  luma?: number;
  /** Per-eye blink blendshape scores, 0-1. Absent when liveness is disabled. */
  blink?: { left: number; right: number };
  /** Head pose in degrees, derived from the facial transformation matrix. */
  pose?: { yaw: number; pitch: number; roll: number };
  /** Mean absolute landmark displacement since the previous sample, normalised. */
  motion?: number;
}

export interface SessionSummary {
  startedAt: number;
  endedAt: number | null;
  totalDurationMs: number;
  /** Absences that escalated far enough to prompt the candidate. */
  absenceCount: number;
  cumulativeAbsentMs: number;
  longestAbsenceMs: number;
  timedOut: boolean;
  /**
   * Separate from `timedOut` on purpose. A session ended because the room was too
   * dark is not the same finding as one ended because the candidate left, and a
   * reviewer must be able to tell them apart — the first may say more about the
   * candidate's equipment than about the candidate.
   */
  qualityTimedOut: boolean;
  multiFaceOccurrences: number;
  livenessFlags: number;
  degradedPeriods: Array<{ reason: QualityReason; durationMs: number }>;
  /** Which cohort's tolerance this session was held to. */
  cohort: ConsumerCohort;
  /** How many repeated-absence warnings were issued. */
  warningsIssued: number;
  /** Whether the cohort's warning limit was reached. */
  warningsExhausted: boolean;
}
