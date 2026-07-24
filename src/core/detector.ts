import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { DetectionSample } from './types.js';

/**
 * Wraps MediaPipe Tasks Vision FaceLandmarker.
 *
 * One model covers all three jobs — presence (face count), blink
 * (`eyeBlinkLeft`/`eyeBlinkRight` blendshapes) and head pose (facial
 * transformation matrix). Running a separate detector for presence would double
 * the CPU we spend, and we share that CPU with a live voice agent. See PRD.md §5.
 */
export interface FaceDetector {
  init(): Promise<void>;
  /** Returns null when the frame could not be sampled (e.g. video not ready). */
  detect(video: HTMLVideoElement, at: number): DetectionSample | null;
  close(): void;
}

export interface DetectorOptions {
  /** Must exceed 1 or a second person is invisible — the model returns at most this many. */
  maxFaces?: number;
  /**
   * Pushed down into MediaPipe's own gate. See the note on `confidence` below for
   * why this is set here rather than compared against a returned score.
   */
  minDetectionConfidence?: number;
  /** Blendshapes are required for blink. Disable only when liveness is off. */
  outputFaceBlendshapes?: boolean;
  outputFacialTransformationMatrixes?: boolean;
  /** Directory holding the MediaPipe WASM bundle. Served locally, not from a CDN. */
  wasmBasePath?: string;
  /** Path to `face_landmarker.task`. */
  modelAssetPath?: string;
  /** Force a delegate. Omit to try GPU and fall back to CPU. */
  delegate?: 'GPU' | 'CPU';
}

const DEFAULTS = {
  maxFaces: 2,
  minDetectionConfidence: 0.5,
  outputFaceBlendshapes: true,
  outputFacialTransformationMatrixes: true,
  wasmBasePath: '/mediapipe/wasm',
  modelAssetPath: '/models/face_landmarker.task',
} as const;

/** Downscale target for the luma sample. Small on purpose — we need a mean, not detail. */
const LUMA_SAMPLE_SIZE = 32;

/** Where init spent its time — the data that tells download apart from GPU compile. */
export interface InitTimings {
  delegate: 'GPU' | 'CPU';
  /** Whether WASM SIMD is available; the non-SIMD path is much slower. */
  simd: boolean | null;
  /** Download + model build (createFromOptions). */
  buildMs: number;
  /** First-inference warm-up — the GPU shader compile that hides on mobile. */
  warmMs: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class MediaPipeFaceDetector implements FaceDetector {
  private landmarker: FaceLandmarker | null = null;
  private initPromise: Promise<void> | null = null;
  private chosenDelegate: 'GPU' | 'CPU' | null = null;
  private initTimings: InitTimings | null = null;
  private lastTimestamp = -1;
  private previousLandmarks: NormalizedLandmark[] | null = null;
  private lumaCanvas: HTMLCanvasElement | null = null;
  private lumaContext: CanvasRenderingContext2D | null = null;

  constructor(private readonly options: DetectorOptions = {}) {}

  /** Which delegate actually loaded. Null until `init()` succeeds. */
  get delegate(): 'GPU' | 'CPU' | null {
    return this.chosenDelegate;
  }

  /** True once the model is loaded and ready — lets the UI reflect warm-up. */
  get ready(): boolean {
    return this.landmarker !== null;
  }

  /** Timing breakdown of init, for diagnostics. Null until init() completes. */
  getInitTimings(): InitTimings | null {
    return this.initTimings;
  }

  /**
   * Idempotent and safe to call before the camera exists, so the ~15MB download
   * and WASM compile can be warmed during the landing screen rather than after
   * the user taps Start. A second call while the first is in flight returns the
   * same promise; a call after success returns immediately.
   */
  init(): Promise<void> {
    if (this.landmarker) return Promise.resolve();
    this.initPromise ??= this.doInit().catch((error) => {
      // Reset so a later Start can retry rather than being stuck on a dead promise.
      this.initPromise = null;
      throw error;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const wasmBasePath = this.options.wasmBasePath ?? DEFAULTS.wasmBasePath;
    const modelAssetPath = this.options.modelAssetPath ?? DEFAULTS.modelAssetPath;
    const t0 = now();

    let simd: boolean | null = null;
    try {
      simd = await FilesetResolver.isSimdSupported();
    } catch {
      simd = null;
    }

    const fileset = await FilesetResolver.forVisionTasks(wasmBasePath);

    const build = async (delegate: 'GPU' | 'CPU'): Promise<FaceLandmarker> =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numFaces: this.options.maxFaces ?? DEFAULTS.maxFaces,
        minFaceDetectionConfidence: this.options.minDetectionConfidence ?? DEFAULTS.minDetectionConfidence,
        minFacePresenceConfidence: this.options.minDetectionConfidence ?? DEFAULTS.minDetectionConfidence,
        outputFaceBlendshapes: this.options.outputFaceBlendshapes ?? DEFAULTS.outputFaceBlendshapes,
        outputFacialTransformationMatrixes:
          this.options.outputFacialTransformationMatrixes ?? DEFAULTS.outputFacialTransformationMatrixes,
      });

    if (this.options.delegate) {
      this.landmarker = await build(this.options.delegate);
      this.chosenDelegate = this.options.delegate;
    } else {
      // TODO(IC-39): benchmark both delegates against a live voice session before
      // assuming GPU is the right default under contention.
      try {
        this.landmarker = await build('GPU');
        this.chosenDelegate = 'GPU';
      } catch (error) {
        console.warn('[presence] GPU delegate unavailable, falling back to CPU', error);
        this.landmarker = await build('CPU');
        this.chosenDelegate = 'CPU';
      }
    }

    const buildMs = now() - t0;

    // Warm-up inference on a blank frame. MediaPipe compiles GPU shaders (or
    // warms the WASM kernels) on the FIRST detectForVideo, not on load — on a
    // weak mobile GPU that first call can take minutes. Paying it here, behind
    // the loading UI, means "ready" is truthful: the interview's first real
    // frame is then fast, instead of the state sitting on INITIALIZING while the
    // phone compiles. Two frames because some backends defer work to the second.
    const w0 = now();
    try {
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(128, 128)
          : Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
      this.landmarker.detectForVideo(canvas as unknown as HTMLCanvasElement, 1);
      this.landmarker.detectForVideo(canvas as unknown as HTMLCanvasElement, 2);
      this.lastTimestamp = 2;
    } catch (error) {
      // Non-fatal: the first real frame simply pays the cost instead.
      console.warn('[presence] warm-up inference failed (non-fatal)', error);
    }
    const warmMs = now() - w0;

    this.initTimings = {
      delegate: this.chosenDelegate ?? 'CPU',
      simd,
      buildMs: Math.round(buildMs),
      warmMs: Math.round(warmMs),
    };
    console.info(
      `[presence] FaceLandmarker ready on ${this.chosenDelegate} ` +
        `(build ${Math.round(buildMs)}ms, warm-up ${Math.round(warmMs)}ms, simd=${simd})`,
    );
  }

  detect(video: HTMLVideoElement, at: number): DetectionSample | null {
    if (!this.landmarker) throw new Error('Detector used before init()');

    // HAVE_CURRENT_DATA. Sampling earlier throws inside MediaPipe.
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    // detectForVideo throws on a non-increasing timestamp. performance.now() can
    // repeat across a fast loop, so nudge rather than skip the frame.
    const timestamp = at > this.lastTimestamp ? at : this.lastTimestamp + 1;
    this.lastTimestamp = timestamp;

    const result = this.landmarker.detectForVideo(video, timestamp);
    const faceCount = result.faceLandmarks.length;
    const landmarks = result.faceLandmarks[0];

    const sample: DetectionSample = {
      at,
      faceCount,
      // FaceLandmarkerResult carries no per-face score — MediaPipe applies
      // minFaceDetectionConfidence internally and returns only faces that pass.
      // So a returned face IS a confident one, and we report 1. Our own
      // `minFaceConfidence` is pushed down into the model options in init()
      // instead of being compared here. See NOTES.md 2026-07-22.
      confidence: faceCount >= 1 ? 1 : 0,
    };

    // Assigned conditionally: under exactOptionalPropertyTypes an explicit
    // `undefined` is not the same as an absent field, and the quality monitor
    // distinguishes "no luma reading" from "dark".
    const luma = this.sampleLuma(video);
    if (luma !== undefined) sample.luma = luma;

    if (faceCount >= 1 && landmarks) {
      const blink = readBlink(result.faceBlendshapes[0]?.categories);
      if (blink) sample.blink = blink;

      const pose = readPose(result.facialTransformationMatrixes[0]);
      if (pose) sample.pose = pose;

      const motion = this.measureMotion(landmarks);
      if (motion !== null) sample.motion = motion;

      this.previousLandmarks = landmarks;
    } else {
      // Do not carry motion across an absence — the first frame back would read
      // as a huge displacement and look like proof of life.
      this.previousLandmarks = null;
    }

    return sample;
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    // Clear the cached promise too, or a later init() would resolve instantly
    // without rebuilding the closed landmarker.
    this.initPromise = null;
    this.chosenDelegate = null;
    this.lastTimestamp = -1;
    this.previousLandmarks = null;
    this.lumaCanvas = null;
    this.lumaContext = null;
  }

  /**
   * Mean luma of a heavily downscaled frame (IC-17). The GPU does the averaging
   * during the downscale, so this stays cheap enough to run every sample.
   */
  private sampleLuma(video: HTMLVideoElement): number | undefined {
    if (!this.lumaCanvas) {
      this.lumaCanvas = document.createElement('canvas');
      this.lumaCanvas.width = LUMA_SAMPLE_SIZE;
      this.lumaCanvas.height = LUMA_SAMPLE_SIZE;
      this.lumaContext = this.lumaCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!this.lumaContext) return undefined;

    try {
      this.lumaContext.drawImage(video, 0, 0, LUMA_SAMPLE_SIZE, LUMA_SAMPLE_SIZE);
      const { data } = this.lumaContext.getImageData(0, 0, LUMA_SAMPLE_SIZE, LUMA_SAMPLE_SIZE);

      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Rec. 601 luma.
        total += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      }
      return total / (data.length / 4);
    } catch {
      // Tainted canvas or a lost context. Absent luma reads as "unknown", and the
      // quality monitor treats unknown as fine rather than as darkness.
      return undefined;
    }
  }

  /**
   * Mean landmark displacement since the previous frame, normalised by face
   * bounding-box size (IC-18). Without normalisation, sitting closer to the
   * camera reads as "more alive" and corrupts the liveness signal at its source.
   */
  private measureMotion(landmarks: NormalizedLandmark[]): number | null {
    const previous = this.previousLandmarks;
    this.previousLandmarks = landmarks;

    if (!previous || previous.length !== landmarks.length || landmarks.length === 0) return null;

    const scale = boundingBoxScale(landmarks);
    if (scale === 0) return null;

    let total = 0;
    for (let i = 0; i < landmarks.length; i += 1) {
      const a = landmarks[i]!;
      const b = previous[i]!;
      total += Math.hypot(a.x - b.x, a.y - b.y);
    }
    return total / landmarks.length / scale;
  }
}

/** Blink blendshapes, 0–1 per eye. Returns null when blendshapes are disabled. */
function readBlink(
  categories: Array<{ categoryName: string; score: number }> | undefined,
): { left: number; right: number } | null {
  if (!categories) return null;
  let left: number | null = null;
  let right: number | null = null;

  for (const category of categories) {
    if (category.categoryName === 'eyeBlinkLeft') left = category.score;
    else if (category.categoryName === 'eyeBlinkRight') right = category.score;
    if (left !== null && right !== null) break;
  }

  return left !== null && right !== null ? { left, right } : null;
}

/**
 * Yaw / pitch / roll in degrees from the 4×4 facial transformation matrix (IC-16).
 *
 * `data` is column-major, so element (row, col) lives at `data[col * 4 + row]`.
 * Reading it row-major silently swaps yaw and pitch — the values still look
 * plausible, which is what makes it worth stating.
 */
export function readPose(
  matrix: { rows: number; columns: number; data: number[] } | undefined,
): { yaw: number; pitch: number; roll: number } | null {
  if (!matrix || matrix.data.length < 16) return null;

  const m = (row: number, col: number): number => matrix.data[col * 4 + row]!;
  const degrees = 180 / Math.PI;

  const sinPitch = -m(2, 0);
  const clamped = Math.min(1, Math.max(-1, sinPitch));

  // Gimbal lock: |sinPitch| ≈ 1 makes yaw and roll degenerate.
  if (Math.abs(clamped) > 0.9999) {
    return {
      yaw: Math.atan2(-m(0, 1), m(1, 1)) * degrees,
      pitch: Math.asin(clamped) * degrees,
      roll: 0,
    };
  }

  return {
    yaw: Math.atan2(m(1, 0), m(0, 0)) * degrees,
    pitch: Math.asin(clamped) * degrees,
    roll: Math.atan2(m(2, 1), m(2, 2)) * degrees,
  };
}

/** Diagonal of the landmark bounding box, in normalised units. */
export function boundingBoxScale(landmarks: Array<{ x: number; y: number }>): number {
  if (landmarks.length === 0) return 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of landmarks) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/**
 * Scripted detector for tests and for driving the demo without a camera —
 * lets the whole event pipeline be exercised deterministically.
 */
export class ScriptedDetector implements FaceDetector {
  private index = 0;
  constructor(private readonly samples: DetectionSample[]) {}
  async init(): Promise<void> {}
  detect(): DetectionSample | null {
    return this.samples[this.index++] ?? null;
  }
  close(): void {
    this.index = 0;
  }
}
