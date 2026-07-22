import type { CameraErrorReason } from './types.js';

export interface CameraOptions {
  /**
   * The host interview app very likely already holds a MediaStream. Passing it in
   * avoids a second getUserMedia call on the same device, which is a common source
   * of `device-busy` on Windows. See PRD.md §10 open question 1.
   *
   * When injected, the stream is NOT ours: `stop()` leaves its tracks running.
   */
  stream?: MediaStream;
  /**
   * An existing video element to attach to. The host app almost certainly already
   * renders the candidate's preview; reusing it avoids decoding the same stream
   * twice. Like an injected stream, an injected element is not ours to remove.
   */
  videoElement?: HTMLVideoElement;
  width?: number;
  height?: number;
  deviceId?: string;
  /**
   * Fires when a track ends underneath us — camera unplugged, revoked in browser
   * settings, or claimed by another app. Distinct from absence: the candidate may
   * be sitting right there.
   */
  onTrackEnded?: () => void;
}

export class CameraError extends Error {
  constructor(
    readonly reason: CameraErrorReason,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

/**
 * Owns the video element and MediaStream lifecycle.
 *
 * The ownership split is the whole point of this class. A stream we acquired is
 * ours to stop; a stream handed to us belongs to the host app and stopping it
 * would kill their video call. `ownsStream` tracks which case we are in and
 * `stop()` respects it.
 */
export class CameraSource {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private ownsStream = false;
  private ownsVideo = false;
  private trackListeners: Array<{ track: MediaStreamTrack; handler: () => void }> = [];

  constructor(private readonly options: CameraOptions = {}) {}

  /** True when we acquired the stream and are therefore responsible for it. */
  get owns(): boolean {
    return this.ownsStream;
  }

  async start(): Promise<HTMLVideoElement> {
    if (this.video) return this.video;

    if (this.options.stream) {
      this.stream = this.options.stream;
      this.ownsStream = false;
    } else {
      this.stream = await this.acquire();
      this.ownsStream = true;
    }

    this.watchTracks(this.stream);
    this.video = await this.attach(this.stream);
    return this.video;
  }

  stop(): void {
    for (const { track, handler } of this.trackListeners) {
      track.removeEventListener('ended', handler);
    }
    this.trackListeners = [];

    // Only tear down what we created. An injected stream is still in use by
    // whoever gave it to us.
    if (this.ownsStream) {
      this.stream?.getTracks().forEach((track) => track.stop());
    }

    if (this.video) {
      this.video.srcObject = null;
      // Only remove an element we created. Removing the host app's preview
      // element would tear a hole in their UI.
      if (this.ownsVideo) this.video.remove();
    }
    this.stream = null;
    this.video = null;
    this.ownsStream = false;
    this.ownsVideo = false;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  /**
   * What the device actually gave us, which is often not what was requested —
   * phones in particular substitute resolutions and frame rates freely. Needed
   * for remote diagnosis when there is no DevTools access to the test device.
   */
  getTrackSettings(): MediaTrackSettings | null {
    return this.stream?.getVideoTracks()[0]?.getSettings() ?? null;
  }

  private async acquire(): Promise<MediaStream> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new CameraError(
        'unsupported',
        'getUserMedia is unavailable. A secure context (https or localhost) is required.',
      );
    }

    const video: MediaTrackConstraints = {
      width: { ideal: this.options.width ?? 640 },
      height: { ideal: this.options.height ?? 480 },
      // Without this a phone may hand us the REAR camera, which points at the
      // desk. Detection then reports a confident, sustained absence for a
      // candidate sitting right there. `ideal` rather than `exact` so a laptop
      // with one camera still works.
      facingMode: { ideal: 'user' },
    };
    if (this.options.deviceId) video.deviceId = { exact: this.options.deviceId };

    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (error) {
      throw new CameraError(toCameraErrorReason(error), describe(error), error);
    }
  }

  /**
   * An offscreen video element. Kept out of the document so the host app controls
   * its own layout — the demo attaches its own preview separately.
   */
  private async attach(stream: MediaStream): Promise<HTMLVideoElement> {
    const video = this.options.videoElement ?? document.createElement('video');
    this.ownsVideo = !this.options.videoElement;

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    await new Promise<void>((resolve, reject) => {
      // An injected element may already have metadata, in which case the event
      // has been and gone and waiting for it would hang start() forever.
      if (video.readyState >= 1) {
        resolve();
        return;
      }

      const onReady = (): void => {
        cleanup();
        resolve();
      };
      const onError = (): void => {
        cleanup();
        reject(new CameraError('track-ended', 'Video element failed to load the stream.'));
      };
      const cleanup = (): void => {
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadedmetadata', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
    });

    // Autoplay can still be refused even when muted. Not fatal on its own —
    // detectForVideo reads frames regardless once metadata has loaded.
    try {
      await video.play();
    } catch {
      /* ignore */
    }

    return video;
  }

  private watchTracks(stream: MediaStream): void {
    for (const track of stream.getVideoTracks()) {
      const handler = (): void => this.options.onTrackEnded?.();
      track.addEventListener('ended', handler);
      this.trackListeners.push({ track, handler });
    }
  }
}

/**
 * Translates a getUserMedia rejection into one of our reason codes.
 *
 * Kept pure and free of `navigator` access so it is unit-testable in Node — the
 * per-browser mapping is exactly the part worth testing without hardware.
 *
 * Browsers disagree here. `NotReadableError` is Chrome's "another app has the
 * camera"; Firefox reports the same situation as `AbortError`. Safari raises
 * `NotAllowedError` for both denial and an insecure context.
 *
 * TODO(IC-38): confirm against Safari during the browser matrix pass.
 */
export function toCameraErrorReason(error: unknown): CameraErrorReason {
  const name = (error as { name?: string } | undefined)?.name;

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError': // legacy Chrome
    case 'SecurityError':
      return 'permission-denied';

    case 'NotFoundError':
    case 'DevicesNotFoundError': // legacy Chrome
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'no-device';

    case 'NotReadableError':
    case 'TrackStartError': // legacy Chrome
    case 'AbortError': // Firefox, for a busy device
      return 'device-busy';

    case 'TypeError':
      // getUserMedia throws TypeError on an insecure origin.
      return 'unsupported';

    default:
      return 'unsupported';
  }
}

function describe(error: unknown): string {
  const reason = toCameraErrorReason(error);
  const detail = (error as { message?: string } | undefined)?.message ?? String(error);

  switch (reason) {
    case 'permission-denied':
      return `Camera permission was denied (${detail})`;
    case 'no-device':
      return `No camera matched the requested constraints (${detail})`;
    case 'device-busy':
      return `The camera is in use by another application (${detail})`;
    default:
      return `Could not access the camera (${detail})`;
  }
}
