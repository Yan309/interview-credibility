/**
 * Every tunable knob lives here. The demo harness (src/demo) binds each of these
 * to a live control so they can be tuned against a real camera rather than guessed.
 *
 * Defaults are starting points, not conclusions. They get calibrated in Phase 4.
 */

export type MultiFacePolicy = 'ignore' | 'flag' | 'treat-as-absent';

export interface LivenessConfig {
  enabled: boolean;
  /** Rolling window over which blink and pose variance are assessed. */
  windowMs: number;
  /** Blendshape score above which an eye counts as closed. */
  blinkThreshold: number;
  /** Minimum ms between counted blinks, to avoid double-counting one blink. */
  blinkRefractoryMs: number;
  /** Below this many blinks in a window, the blink signal reads as dead. */
  minBlinksPerWindow: number;
  /** Below this variance (deg^2, summed over yaw/pitch/roll), pose reads as dead. */
  minPoseVariance: number;
  /** Below this mean landmark displacement, micro-motion reads as dead. */
  minMotion: number;
  /** How many dead signals must coincide before flagging. Two by design. */
  minSignalsToFlag: number;
}

export interface PresenceConfig {
  // ---- sampling ----
  targetFps: number;

  // ---- presence ----
  minFaceConfidence: number;
  /** Length of the rolling buffer the presence ratio is computed over. */
  bufferWindowMs: number;
  /** Enter absence when the presence ratio falls below this. */
  absenceEnterRatio: number;
  /** Recover to present when the ratio rises above this. Deliberately higher
   *  than absenceEnterRatio — the gap is the hysteresis band that stops flapping. */
  presenceRecoverRatio: number;
  /** Silent grace after absence begins, before the candidate is prompted. */
  absenceGraceMs: number;
  /** How long recovery must hold before we clear a prompted absence. */
  recoveryConfirmMs: number;
  /** From absence:started to absence:timeout. */
  absenceTimeoutMs: number;

  // ---- multi-face ----
  multiFacePolicy: MultiFacePolicy;
  multiFaceGraceMs: number;

  // ---- quality ----
  /** Mean luma 0-255 below which the frame is too dark to judge presence. */
  lowLightLumaThreshold: number;
  /** Sustained fps below this counts as degraded (backgrounded tab, throttling). */
  lowFpsThreshold: number;
  /** How long a quality problem must persist before it is reported. */
  qualityDebounceMs: number;
  /**
   * Time the candidate gets to fix unusable camera conditions before
   * `quality:timeout` fires.
   *
   * Longer than `absenceTimeoutMs` deliberately: stepping back into frame takes
   * seconds, but fixing a room's lighting means standing up, finding a lamp, and
   * moving furniture. The timer only runs while the frame is degraded AND no face
   * is detectable — if we can still see the candidate, poor lighting alone never
   * escalates.
   */
  lightingTimeoutMs: number;

  // ---- liveness ----
  liveness: LivenessConfig;
}

export const DEFAULT_CONFIG: PresenceConfig = {
  targetFps: 10,

  minFaceConfidence: 0.5,
  bufferWindowMs: 2000,
  absenceEnterRatio: 0.2,
  presenceRecoverRatio: 0.6,
  absenceGraceMs: 3000,
  recoveryConfirmMs: 1000,
  absenceTimeoutMs: 30000,

  multiFacePolicy: 'flag',
  multiFaceGraceMs: 5000,

  lowLightLumaThreshold: 40,
  lowFpsThreshold: 4,
  qualityDebounceMs: 2000,
  lightingTimeoutMs: 60000,

  liveness: {
    enabled: true,
    windowMs: 20000,
    blinkThreshold: 0.5,
    blinkRefractoryMs: 200,
    minBlinksPerWindow: 2,
    minPoseVariance: 0.5,
    minMotion: 0.0015,
    minSignalsToFlag: 2,
  },
};

export function resolveConfig(overrides: DeepPartial<PresenceConfig> = {}): PresenceConfig {
  const merged: PresenceConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
    liveness: { ...DEFAULT_CONFIG.liveness, ...overrides.liveness },
  } as PresenceConfig;

  assertConfig(merged);
  return merged;
}

/**
 * Catches the config mistakes that produce confusing runtime behaviour rather
 * than an obvious error — most importantly an inverted hysteresis band, which
 * looks like "the detector is flaky" instead of like a bad setting.
 */
export function assertConfig(config: PresenceConfig): void {
  if (config.presenceRecoverRatio <= config.absenceEnterRatio) {
    throw new Error(
      `presenceRecoverRatio (${config.presenceRecoverRatio}) must exceed absenceEnterRatio ` +
        `(${config.absenceEnterRatio}); otherwise presence flaps at the threshold.`,
    );
  }
  if (config.absenceTimeoutMs <= config.absenceGraceMs) {
    throw new Error('absenceTimeoutMs must exceed absenceGraceMs.');
  }
  if (config.targetFps <= 0) throw new Error('targetFps must be positive.');
  if (config.bufferWindowMs <= 0) throw new Error('bufferWindowMs must be positive.');
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
