import { CameraError, MediaPipeFaceDetector, PresenceRuntime } from '../core/index.js';
import type { CameraErrorReason, QualityReason } from '../core/index.js';
import { mountControls } from './controls.js';
import { mountEventLog } from './event-log.js';
import { copyText, createRecorder } from './diagnostics.js';

/**
 * Client-testable harness.
 *
 * The instrument view — video, prompts, config sliders, event log, live summary —
 * is now the only view. The stripped-down "clean" view was removed at the owner's
 * request: it had layout bugs, and the client wants the metrics visible.
 *
 * The shipping surface is src/core. Nothing in this folder gets integrated.
 */

const params = new URLSearchParams(location.search);
// Escape hatch for the in-app detector below — the UA sniff will eventually be
// wrong about somebody, and locking out a real tester with no override is worse
// than letting them through to a clear camera error.
const FORCE = params.get('force') === '1';

const el = {
  screenBlocked: q<HTMLElement>('#screen-blocked'),
  screenLanding: q<HTMLElement>('#screen-landing'),
  screenError: q<HTMLElement>('#screen-error'),
  errorTitle: q<HTMLHeadingElement>('#error-title'),
  errorDetail: q<HTMLParagraphElement>('#error-detail'),
  errorRetry: q<HTMLButtonElement>('#error-retry'),
  begin: q<HTMLButtonElement>('#begin'),
  prepHint: q<HTMLParagraphElement>('#prep-hint'),
  app: q<HTMLElement>('#app'),
  toggle: q<HTMLButtonElement>('#toggle'),
  statePill: q<HTMLSpanElement>('#state-pill'),
  video: q<HTMLVideoElement>('#video'),
  fps: q<HTMLSpanElement>('#fps'),
  prompt: q<HTMLDivElement>('#prompt'),
  countdown: q<HTMLSpanElement>('#countdown'),
  warningLine: q<HTMLParagraphElement>('#warning-line'),
  qualityPrompt: q<HTMLDivElement>('#quality-prompt'),
  qualityTitle: q<HTMLHeadingElement>('#quality-title'),
  qualityDetail: q<HTMLParagraphElement>('#quality-detail'),
  qualityCountdown: q<HTMLSpanElement>('#quality-countdown'),
  ended: q<HTMLDivElement>('#ended'),
  endedDetail: q<HTMLParagraphElement>('#ended-detail'),
  banner: q<HTMLDivElement>('#banner'),
  summary: q<HTMLPreElement>('#summary'),
  diagnostics: q<HTMLButtonElement>('#diagnostics'),
  buildStamp: q<HTMLDivElement>('#build-stamp'),
};

function q<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

// ---------------------------------------------------------------- setup

el.buildStamp.textContent = `build ${__BUILD__.slice(0, 16).replace('T', ' ')}`;
// The instrument is always on now — this class is what reveals the config panel,
// event log and metrics.
document.body.classList.add('debug');

// Delegate choice. On mobile the WebGL/GPU path compiles shaders on the first
// inference, which can take *minutes* on a weak phone GPU — the CPU (WASM SIMD)
// path has no such compile and starts almost immediately, at the cost of a lower
// frame rate that presence detection tolerates fine. So mobile defaults to CPU;
// desktop keeps GPU-first (fast compile, faster inference). Override either way
// with ?delegate=gpu or ?delegate=cpu.
const forcedDelegate = params.get('delegate')?.toUpperCase();
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const delegate: 'GPU' | 'CPU' | undefined =
  forcedDelegate === 'CPU' ? 'CPU' : forcedDelegate === 'GPU' ? 'GPU' : isMobile ? 'CPU' : undefined;

const runtime = new PresenceRuntime({
  camera: {
    videoElement: el.video,
    // Capture at a lower resolution on mobile. Inference cost scales with pixel
    // count, so 320x240 vs 640x480 is roughly a 4x speedup on the CPU path — the
    // difference between a phone keeping up and stalling. A phone screen shows
    // the preview fine at this size.
    ...(isMobile ? { width: 320, height: 240 } : {}),
  },
  detector: new MediaPipeFaceDetector(delegate ? { delegate } : {}),
});

const diagnostics = createRecorder(runtime);

// Preload the model now, while the landing screen is up, and keep Start disabled
// until it is ready. The ~15MB download + WASM compile is the real cost behind the
// long "INITIALIZING"; the browser must download the model once to run detection
// locally, so it cannot be avoided — but it should never be invisible. Gating the
// button means the user is never left tapping a button that appears to do nothing.
if (!isInAppBrowser() || FORCE) {
  setPrepState('preparing');
  void runtime.warmUp().then(() => setPrepState(runtime.isWarm() ? 'ready' : 'failed'));
}

/** Drives the landing-screen readiness: button enabled/label and the status hint. */
function setPrepState(state: 'preparing' | 'ready' | 'failed'): void {
  switch (state) {
    case 'preparing':
      el.begin.disabled = true;
      el.begin.textContent = 'Preparing…';
      el.prepHint.hidden = false;
      break;
    case 'ready':
      el.begin.disabled = false;
      el.begin.textContent = 'Start camera';
      el.prepHint.hidden = true;
      break;
    case 'failed':
      // Enable anyway: tapping Start re-runs init() and surfaces the real error
      // on the error screen, which beats a permanently dead button.
      el.begin.disabled = false;
      el.begin.textContent = 'Start camera';
      el.prepHint.textContent = 'Setup did not finish loading. Press Start to try again.';
      el.prepHint.hidden = false;
      break;
  }
}

mountControls(q('#controls'), runtime.config);
const log = mountEventLog(q('#event-log'));

// ---------------------------------------------------------------- in-app browsers

/**
 * Embedded webviews either block getUserMedia or grant it unreliably. `wv)` is
 * the Android WebView marker; the rest are the apps people actually paste links
 * into. Deliberately a UA sniff — there is no feature test that distinguishes an
 * in-app browser before the camera prompt has already failed.
 */
function isInAppBrowser(): boolean {
  const ua = navigator.userAgent;
  return /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|\bLine\/|WhatsApp|Snapchat|Twitter|wv\)/i.test(ua);
}

if (isInAppBrowser() && !FORCE) {
  el.screenLanding.hidden = true;
  el.screenBlocked.hidden = false;
}

// ---------------------------------------------------------------- copy

/**
 * Cause-specific copy. A candidate told only "there is a problem" cannot fix it;
 * naming the actual condition is what makes the countdown actionable.
 */
const QUALITY_COPY: Record<QualityReason, { title: string; detail: string }> = {
  'low-light': {
    title: 'Insufficient lighting detected',
    detail:
      'The camera image is too dark to confirm that you are present. Please increase the lighting in your room, or move to a brighter area.',
  },
  occluded: {
    title: 'Your face is partially obscured',
    detail:
      'The camera cannot see your face clearly. Please remove any obstruction and face the camera directly.',
  },
  'low-fps': {
    title: 'Camera feed is unstable',
    detail:
      'The camera feed has slowed considerably. Please close other applications using the camera, and keep this window in the foreground.',
  },
};

/** Every failure gets a heading, a next step, and a decision about retrying. */
const CAMERA_COPY: Record<CameraErrorReason, { title: string; detail: string; retry: boolean }> = {
  'permission-denied': {
    title: 'Camera permission is blocked',
    detail:
      'Your browser is not allowing camera access. On iPhone, open Settings › Safari › Camera and set it to Ask or Allow. On Android, tap the lock icon beside the web address and allow Camera. Then return here and try again.',
    retry: true,
  },
  'no-device': {
    title: 'No camera found',
    detail: 'This device does not appear to have a camera available to the browser.',
    retry: true,
  },
  'device-busy': {
    title: 'The camera is already in use',
    detail:
      'Another app is using the camera. Please close any video call or camera app that is open, then try again.',
    retry: true,
  },
  'track-ended': {
    title: 'The camera disconnected',
    detail: 'The camera stopped unexpectedly. This can happen if another app took it over.',
    retry: true,
  },
  unsupported: {
    title: 'This browser cannot use the camera',
    detail:
      'Camera access is not available in this browser. Please open this page in Safari on iPhone, or Chrome on Android.',
    retry: false,
  },
};

// ---------------------------------------------------------------- events

runtime.on((event) => {
  log(event);
  diagnostics.recordEvent(event);

  el.statePill.textContent = runtime.getState();
  el.statePill.className = `pill pill--${runtime.getState().toLowerCase().replace('_', '-')} debug-only`;

  switch (event.type) {
    case 'absence:started':
      el.prompt.hidden = false;
      break;
    case 'absence:resolved':
      el.prompt.hidden = true;
      break;
    case 'absence:timeout':
      el.prompt.hidden = true;
      endSession(
        'This interview ended automatically because the camera did not show a participant for the required period.',
      );
      // The host app ends the interview here. The module only reports.
      break;
    case 'quality:degraded':
      el.qualityTitle.textContent = QUALITY_COPY[event.reason].title;
      el.qualityDetail.textContent = QUALITY_COPY[event.reason].detail;
      el.qualityPrompt.hidden = false;
      break;
    case 'quality:restored':
      el.qualityPrompt.hidden = true;
      hideBanner();
      break;
    case 'quality:timeout':
      el.qualityPrompt.hidden = true;
      endSession(
        'This interview ended automatically because the camera conditions did not allow your presence to be confirmed.',
      );
      break;
    case 'warning:issued':
      // Shown inside the return prompt as "warning N of M". The exhausting
      // warning is handled by warnings:exhausted below, which ends the session,
      // so the warning line only ever shows counts short of the limit.
      if (event.count < event.limit) {
        el.warningLine.textContent = `This is warning ${event.count} of ${event.limit}. Repeated absences may end the interview.`;
        el.warningLine.hidden = false;
      }
      break;
    case 'warnings:exhausted':
      el.prompt.hidden = true;
      endSession(
        'This interview ended automatically after you left the camera view more times than permitted.',
      );
      break;
    case 'liveness:suspect':
      // Advisory only, and for the operator — never shown to the candidate.
      console.warn('[presence] liveness suspect:', event.signals);
      break;
    case 'camera:error':
      // Mid-session loss. A failure at start() is handled by the catch in begin().
      if (running) showErrorScreen(event.reason);
      break;
    default:
      break;
  }

  el.summary.textContent = JSON.stringify(runtime.getSessionSummary(), null, 2);
});

// ---------------------------------------------------------------- lifecycle

let running = false;
let fpsTimer: number | null = null;
let tickTimer: number | null = null;

el.begin.addEventListener('click', () => void begin());
el.errorRetry.addEventListener('click', () => void begin());
el.toggle.addEventListener('click', () => {
  if (running) {
    stop();
    showScreen(el.screenLanding);
  } else {
    void begin();
  }
});

async function begin(): Promise<void> {
  el.begin.disabled = true;
  el.errorRetry.disabled = true;
  el.begin.textContent = 'Starting…';

  try {
    // getUserMedia must be reached from this tap. Nothing awaits before it.
    await runtime.start();
    running = true;
    showScreen(el.app);
    el.ended.hidden = true;
    el.toggle.textContent = 'Stop';

    fpsTimer = window.setInterval(() => {
      el.fps.textContent = `${runtime.getMeasuredFps()} fps`;
    }, 500);
    // 4Hz so the displayed second changes promptly after a state transition.
    tickTimer = window.setInterval(tickCountdowns, 250);

    showBanner(`Running on ${runtime.getDelegate() ?? 'unknown'} delegate.`);
  } catch (error) {
    diagnostics.recordError('start', error);
    showErrorScreen(error);
  } finally {
    el.begin.disabled = false;
    el.errorRetry.disabled = false;
    el.begin.textContent = 'Start camera';
  }
}

function stop(): void {
  runtime.stop();
  running = false;
  el.prompt.hidden = true;
  el.qualityPrompt.hidden = true;
  if (fpsTimer !== null) window.clearInterval(fpsTimer);
  if (tickTimer !== null) window.clearInterval(tickTimer);
  fpsTimer = null;
  tickTimer = null;
  el.fps.textContent = '— fps';
}

/**
 * Both countdowns are read from the runtime every tick rather than being run
 * locally. The absence clock freezes while quality is degraded, so a local timer
 * would drift out of sync and could show a session ending that had not escalated.
 */
function tickCountdowns(): void {
  const absence = runtime.getAbsenceRemainingMs();
  if (absence !== null) el.countdown.textContent = formatRemaining(absence);

  const quality = runtime.getQualityRemainingMs(performance.now());
  if (quality !== null) el.qualityCountdown.textContent = formatRemaining(quality);
}

/** mm:ss — a bare seconds count reads as a stopwatch rather than a deadline. */
function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function endSession(detail: string): void {
  el.endedDetail.textContent = detail;
  el.ended.hidden = false;
}

// ---------------------------------------------------------------- screens

function showScreen(target: HTMLElement): void {
  for (const screen of [el.screenBlocked, el.screenLanding, el.screenError, el.app]) {
    screen.hidden = screen !== target;
  }
}

function showErrorScreen(source: unknown): void {
  if (running) stop();

  const reason: CameraErrorReason | null =
    typeof source === 'string'
      ? (source as CameraErrorReason)
      : source instanceof CameraError
        ? source.reason
        : null;

  if (reason && CAMERA_COPY[reason]) {
    const copy = CAMERA_COPY[reason];
    el.errorTitle.textContent = copy.title;
    el.errorDetail.textContent = copy.detail;
    el.errorRetry.hidden = !copy.retry;
  } else {
    const message = source instanceof Error ? source.message : String(source);
    const missingModel = /face_landmarker|404|Failed to fetch|abort/i.test(message);
    el.errorTitle.textContent = missingModel ? 'Could not load the face model' : 'Could not start the camera';
    el.errorDetail.textContent = missingModel
      ? 'A required file did not load. Check your connection and try again. If this keeps happening, tap "Copy diagnostics" and send the result.'
      : `${message}. Tap "Copy diagnostics" and send the result if this keeps happening.`;
    el.errorRetry.hidden = false;
  }

  showScreen(el.screenError);
}

function showBanner(message: string): void {
  el.banner.textContent = message;
  el.banner.hidden = false;
}

function hideBanner(): void {
  el.banner.hidden = true;
}

// ---------------------------------------------------------------- diagnostics

el.diagnostics.addEventListener('click', () => {
  const text = diagnostics.build();
  const original = el.diagnostics.textContent;

  void copyText(text).then((ok) => {
    el.diagnostics.textContent = ok ? 'Copied ✓' : 'Copy failed — see console';
    if (!ok) console.log(text);
    window.setTimeout(() => {
      el.diagnostics.textContent = original;
    }, 2000);
  });
});

// Console handle for local diagnosis.
(window as unknown as { presence: unknown }).presence = {
  runtime,
  video: el.video,
  diagnostics: () => diagnostics.build(),
};
