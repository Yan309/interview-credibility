import { CameraError, CameraSource, type CameraOptions } from './camera.js';
import { resolveConfig, type DeepPartial, type PresenceConfig } from './config.js';
import { MediaPipeFaceDetector, type FaceDetector } from './detector.js';
import { PresenceEmitter, type Unsubscribe } from './emitter.js';
import { LivenessScorer } from './liveness-scorer.js';
import { PresenceMachine } from './presence-machine.js';
import { QualityMonitor } from './quality-monitor.js';
import { SessionSummaryBuilder } from './session-summary.js';
import { WarningTracker } from './warning-tracker.js';
import type { PresenceEvent, PresenceState, SessionSummary } from './types.js';

export interface PresenceRuntimeOptions {
  config?: DeepPartial<PresenceConfig>;
  camera?: CameraOptions;
  /** Override for tests or for driving the demo without a camera. */
  detector?: FaceDetector;
  /** Override for deterministic tests. */
  now?: () => number;
}

/**
 * The one class the host application touches.
 *
 * It deliberately does NOT end the interview. On `absence:timeout` it emits and
 * stops there — session lifecycle, transcript flushing and cleanup belong to the
 * interview app, and it must stay the thing that decides an interview is over.
 * See PRD.md §5.
 *
 */
export class PresenceRuntime {
  readonly config: PresenceConfig;
  private readonly emitter = new PresenceEmitter();
  private readonly machine: PresenceMachine;
  private readonly liveness: LivenessScorer;
  private readonly quality: QualityMonitor;
  private readonly warnings: WarningTracker;
  private readonly camera: CameraSource;
  private readonly detector: FaceDetector;
  private readonly now: () => number;
  private summary: SessionSummaryBuilder | null = null;
  private running = false;
  private video: HTMLVideoElement | null = null;
  private frameHandle: number | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastSampleAt: number | null = null;
  /** Duration of the most recent detect(), to tell slow inference from a sleep. */
  private lastDetectMs = 0;
  private sampleTimestamps: number[] = [];
  private qualityUnusableSince: number | null = null;
  private qualityTimeoutFired = false;

  constructor(options: PresenceRuntimeOptions = {}) {
    this.config = resolveConfig(options.config);
    this.now = options.now ?? (() => performance.now());
    this.machine = new PresenceMachine(this.config);
    this.liveness = new LivenessScorer(this.config.liveness);
    this.quality = new QualityMonitor(this.config);
    this.warnings = new WarningTracker(this.config);
    this.camera = new CameraSource({
      ...options.camera,
      onTrackEnded: () => this.handleTrackEnded(),
    });
    this.detector = options.detector ?? new MediaPipeFaceDetector();
  }

  on: PresenceEmitter['on'] = ((...args: Parameters<PresenceEmitter['on']>) =>
    (this.emitter.on as (...a: unknown[]) => Unsubscribe)(...args)) as PresenceEmitter['on'];

  getState(): PresenceState {
    return this.machine.getState();
  }

  getSessionSummary(): SessionSummary | null {
    return this.summary?.build(this.now()) ?? null;
  }

  /**
   * Measured sample rate over the last second. IC-20's gate is ≥10fps, and that
   * has to be a number rather than an impression.
   */
  getMeasuredFps(): number {
    return this.sampleTimestamps.length;
  }

  /** Actual camera settings as negotiated with the device. Null before start(). */
  getCameraSettings(): MediaTrackSettings | null {
    return this.camera.getTrackSettings();
  }

  /**
   * Video element readiness. `readyState < 2` or `videoWidth === 0` means detect()
   * returns null every frame — the machine then sits on INITIALIZING while the loop
   * still spins (fps looks fine). This is what tells that state apart from a real
   * detection problem.
   */
  getVideoStatus(): { readyState: number; videoWidth: number; paused: boolean } | null {
    if (!this.video) return null;
    return { readyState: this.video.readyState, videoWidth: this.video.videoWidth, paused: this.video.paused };
  }

  /** Which delegate the detector loaded, when it reports one (IC-19). */
  getDelegate(): string | null {
    const detector = this.detector as { delegate?: 'GPU' | 'CPU' | null };
    return detector.delegate ?? null;
  }

  /** Init timing breakdown, for diagnostics. Null until warm/started. */
  getInitTimings(): unknown {
    const detector = this.detector as { getInitTimings?: () => unknown };
    return detector.getInitTimings?.() ?? null;
  }

  /**
   * Loads the model without touching the camera, so the ~15MB download and WASM
   * compile can happen ahead of time — e.g. while a landing screen is shown. The
   * subsequent start() then only needs camera permission and is near-instant.
   *
   * Best-effort: any failure here is swallowed, because start() runs init() again
   * and surfaces the error properly through the camera:error path.
   */
  async warmUp(): Promise<void> {
    try {
      await this.detector.init();
    } catch {
      /* start() will retry and report */
    }
  }

  /** True once the detector is loaded and start() will be fast. */
  isWarm(): boolean {
    return (this.detector as { ready?: boolean }).ready ?? false;
  }

  /**
   * Acquires the camera, loads the model, and starts sampling.
   *
   * Camera failures are emitted as `camera:error` AND rethrown: the host app needs
   * to know start() did not succeed, and a caller that only awaits the promise
   * should not have to also subscribe to find out.
   */
  async start(): Promise<void> {
    if (this.running) return;

    let video: HTMLVideoElement;
    try {
      video = await this.camera.start();
      await this.detector.init();
    } catch (error) {
      // The camera may already be live — acquisition succeeds before the model
      // loads. Releasing it here matters: otherwise a failed start leaves the
      // camera light on, which reads to the candidate as being recorded.
      this.camera.stop();
      this.detector.close();

      this.machine.markCameraError();
      this.dispatch([
        {
          type: 'camera:error',
          at: this.now(),
          reason: error instanceof CameraError ? error.reason : 'unsupported',
        },
      ]);
      throw error;
    }

    this.video = video;
    this.beginSession();
    this.startLoop(video);
  }

  stop(): void {
    this.running = false;
    this.stopLoop();
    this.detector.close();
    this.camera.stop();
    this.video = null;
    this.dispatch([{ type: 'session:stopped', at: this.now() }]);
  }

  /**
   * Sampling is decoupled from render (IC-20).
   *
   * `requestVideoFrameCallback` fires per decoded video frame rather than per
   * repaint, so we never contend with the interview UI's animation frames. It is
   * also throttled hard by a backgrounded tab — which is correct here: that must
   * surface as `low-fps`, never as the candidate having left.
   *
   * Where it is unsupported (Firefox), setInterval is the fallback.
   */
  private startLoop(video: HTMLVideoElement): void {
    const minGapMs = 1000 / this.config.targetFps;

    const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';

    if (hasFrameCallback) {
      // Throttle to targetFps: cameras deliver 30fps and we do not need it.
      //
      // The tolerance matters. Frames arrive on a ~33ms grid, so a strict
      // `elapsed >= 100ms` test skips the frame at 100ms and waits for 133ms —
      // yielding ~7.5fps while targetFps says 10. Allowing a frame that lands
      // fractionally early snaps sampling back onto the 100ms cadence.
      const tolerance = minGapMs * 0.2;

      const onFrame = (): void => {
        if (!this.running) return;
        const at = this.now();
        if (this.lastSampleAt === null || at - this.lastSampleAt >= minGapMs - tolerance) {
          this.sampleOnce(video, at);
        }
        this.frameHandle = video.requestVideoFrameCallback(onFrame);
      };
      this.frameHandle = video.requestVideoFrameCallback(onFrame);
      return;
    }

    this.intervalHandle = setInterval(() => {
      if (!this.running) return;
      this.sampleOnce(video, this.now());
    }, minGapMs);
  }

  private stopLoop(): void {
    if (this.frameHandle !== null && this.video) {
      this.video.cancelVideoFrameCallback?.(this.frameHandle);
    }
    if (this.intervalHandle !== null) clearInterval(this.intervalHandle);
    this.frameHandle = null;
    this.intervalHandle = null;
    this.lastSampleAt = null;
  }

  private sampleOnce(video: HTMLVideoElement, at: number): void {
    // Discontinuity guard (IC-21). A closed laptop lid, a suspended tab, or a
    // resumed machine leaves a gap that would otherwise be read as one enormous
    // absence — and time the candidate out for something entirely harmless.
    //
    // But we must NOT mistake slow inference for a discontinuity. On a weak phone
    // a single CPU detect() can take several seconds; comparing the raw gap to the
    // threshold then fires on every frame, resetting to INITIALIZING forever. So
    // subtract the time our own last detect() took: a real sleep leaves a large
    // IDLE gap, slow-but-continuous inference does not.
    if (this.lastSampleAt !== null) {
      const idleGap = at - this.lastSampleAt - this.lastDetectMs;
      if (idleGap > this.discontinuityThresholdMs()) {
        this.machine.reset(at);
        this.quality.reset();
        this.liveness.reset();
        this.lastSampleAt = at;
        this.lastDetectMs = 0;
        return;
      }
    }
    this.lastSampleAt = at;

    this.sampleTimestamps.push(at);
    const cutoff = at - 1000;
    while (this.sampleTimestamps.length > 0 && this.sampleTimestamps[0]! < cutoff) {
      this.sampleTimestamps.shift();
    }

    let sample;
    const detectStart = this.now();
    try {
      sample = this.detector.detect(video, at);
    } catch (error) {
      this.lastDetectMs = 0;
      console.error('[presence] detect() threw', error);
      return;
    }
    this.lastDetectMs = this.now() - detectStart;

    if (sample) this.processSample(sample);
  }

  /** Gap beyond which we assume a discontinuity rather than a slow frame. */
  private discontinuityThresholdMs(): number {
    return Math.max((1000 / this.config.targetFps) * 10, 2000);
  }

  private handleTrackEnded(): void {
    this.running = false;
    this.stopLoop();
    this.machine.markCameraError();
    this.dispatch([{ type: 'camera:error', at: this.now(), reason: 'track-ended' }]);
  }

  /**
   * The per-sample fan-out. Extracted so the whole pipeline can be exercised from
   * a scripted sample list with no camera and no model.
   */
  processSample(sample: Parameters<PresenceMachine['ingest']>[0]): PresenceEvent[] {
    const events: PresenceEvent[] = [];

    events.push(...this.quality.ingest(sample));
    // Suspend escalation while we cannot see well enough to judge.
    this.machine.setSuspended(this.quality.isDegraded(), sample.at);

    events.push(...this.evaluateQualityTimeout(sample));

    const machineEvents = this.machine.ingest(sample);
    events.push(...machineEvents);
    // Each escalated absence is a strike against the cohort's allowance.
    for (const event of machineEvents) {
      if (event.type === 'absence:started') {
        events.push(...this.warnings.onAbsenceStarted(event.at));
      }
    }

    if (sample.faceCount >= 1 && !this.quality.isDegraded()) {
      events.push(...this.liveness.ingest(sample));
    }

    this.dispatch(events);
    return events;
  }

  /**
   * Runs the lighting-recovery clock.
   *
   * Two conditions, both required: the frame is degraded AND no face is
   * detectable. If the candidate is still visible despite poor lighting there is
   * nothing to escalate — they are demonstrably present, and ending the session
   * would be indefensible. Any detectable face resets the clock.
   */
  private evaluateQualityTimeout(sample: Parameters<PresenceMachine['ingest']>[0]): PresenceEvent[] {
    const reason = this.quality.getReason();
    const unusable = this.quality.isDegraded() && sample.faceCount === 0;

    if (!unusable) {
      this.qualityUnusableSince = null;
      this.qualityTimeoutFired = false;
      return [];
    }

    this.qualityUnusableSince ??= sample.at;

    const elapsed = sample.at - this.qualityUnusableSince;
    if (!this.qualityTimeoutFired && elapsed >= this.config.lightingTimeoutMs) {
      this.qualityTimeoutFired = true;
      return [
        {
          type: 'quality:timeout',
          at: sample.at,
          reason: reason ?? 'low-light',
          durationMs: elapsed,
        },
      ];
    }
    return [];
  }

  /** Milliseconds until `quality:timeout`, or null when the clock is not running. */
  getQualityRemainingMs(now: number): number | null {
    if (this.qualityUnusableSince === null || this.qualityTimeoutFired) return null;
    return Math.max(0, this.config.lightingTimeoutMs - (now - this.qualityUnusableSince));
  }

  /** Milliseconds until `absence:timeout`, or null when no absence is running. */
  getAbsenceRemainingMs(now: number = this.now()): number | null {
    return this.machine.getAbsenceRemainingMs(now);
  }

  private dispatch(events: PresenceEvent[]): void {
    for (const event of events) this.summary?.record(event);
    this.emitter.emitAll(events);
  }

  /** Repeated-absence warnings issued so far this session. */
  getWarningCount(): number {
    return this.warnings.getCount();
  }

  /** @internal — exposed for the demo harness and tests. */
  beginSession(at: number = this.now()): void {
    this.summary = new SessionSummaryBuilder(at, this.config.cohort);
    this.warnings.reset();
    this.running = true;
    this.dispatch([{ type: 'session:started', at }]);
  }
}
