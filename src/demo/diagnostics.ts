import type { PresenceEvent, PresenceRuntime } from '../core/index.js';

/**
 * One-tap diagnostics for remote testing.
 *
 * A client testing on their own phone has no DevTools, no console, and no way to
 * describe what went wrong beyond "it didn't work". This turns that into a
 * paste-able block of facts.
 *
 * Lives in src/demo deliberately: `navigator.clipboard` is on the egress
 * blocklist for src/core, and correctly so — the shipping module has no business
 * touching the clipboard.
 *
 * Nothing here is transmitted anywhere. It goes to the clipboard and the tester
 * chooses where to paste it.
 */

const MAX_EVENTS = 20;

export interface DiagnosticsRecorder {
  recordEvent(event: PresenceEvent): void;
  recordError(context: string, error: unknown): void;
  build(): string;
}

export function createRecorder(runtime: PresenceRuntime): DiagnosticsRecorder {
  const events: Array<{ at: number; text: string }> = [];
  const errors: string[] = [];
  const startedAt = Date.now();

  // Uncaught failures are exactly what a remote tester cannot report, so they
  // get captured rather than only logged to a console nobody will read.
  window.addEventListener('error', (e) => record(`window.onerror: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) =>
    record(`unhandledrejection: ${describe(e.reason)}`),
  );

  function record(text: string): void {
    if (errors.length < 25) errors.push(`[${elapsed()}] ${text}`);
  }

  function elapsed(): string {
    return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  }

  return {
    recordEvent(event) {
      const detail = Object.entries(event)
        .filter(([key]) => key !== 'type' && key !== 'at')
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(' ');
      events.push({ at: event.at, text: `${event.type}${detail ? ` ${detail}` : ''}` });
      if (events.length > MAX_EVENTS) events.shift();
    },

    recordError(context, error) {
      record(`${context}: ${describe(error)}`);
    },

    build() {
      const settings = runtime.getCameraSettings();
      const lines: string[] = [];

      lines.push('=== PRESENCE MODULE DIAGNOSTICS ===');
      lines.push(`Captured        ${new Date().toISOString()}`);
      lines.push(`Build           ${__BUILD__}`);
      lines.push(`Session length  ${elapsed()}`);
      lines.push('');

      lines.push('--- Device ---');
      lines.push(`User agent      ${navigator.userAgent}`);
      lines.push(`Platform        ${navigator.platform}`);
      lines.push(`Screen          ${screen.width}x${screen.height} @${devicePixelRatio}x`);
      lines.push(`Viewport        ${innerWidth}x${innerHeight}`);
      lines.push(`Orientation     ${screen.orientation?.type ?? 'unknown'}`);
      lines.push(`Secure context  ${isSecureContext}`);
      lines.push(`Origin          ${location.origin}`);
      lines.push('');

      lines.push('--- Camera ---');
      if (settings) {
        lines.push(`Resolution      ${settings.width ?? '?'}x${settings.height ?? '?'}`);
        lines.push(`Reported fps    ${settings.frameRate ?? 'unreported'}`);
        // Which physical camera the device chose. A rear camera here explains a
        // session of constant false absences on its own.
        lines.push(`Facing mode     ${settings.facingMode ?? 'unreported'}`);
        lines.push(`Device ID       ${settings.deviceId ? `${settings.deviceId.slice(0, 12)}…` : 'unreported'}`);
      } else {
        lines.push('Camera          not started');
      }
      const video = runtime.getVideoStatus() as
        | { readyState: number; videoWidth: number; paused: boolean }
        | null;
      lines.push(
        video
          ? `Video element   readyState=${video.readyState} width=${video.videoWidth} paused=${video.paused}`
          : 'Video element   not attached',
      );
      lines.push('');

      lines.push('--- Detection ---');
      lines.push(`State           ${runtime.getState()}`);
      lines.push(`Delegate        ${runtime.getDelegate() ?? 'not loaded'}`);
      // 'timer' here on Android Chrome confirms the rVFC watchdog kicked in.
      lines.push(`Loop driver     ${(runtime as { getLoopDriver?: () => string | null }).getLoopDriver?.() ?? 'n/a'}`);
      lines.push(`Measured fps    ${runtime.getMeasuredFps()} (target ${runtime.config.targetFps})`);
      // Splits the startup wait: a large warm-up figure = GPU shader compile
      // (the mobile trap); a large build figure = download/model init.
      const timings = runtime.getInitTimings() as
        | { delegate: string; simd: boolean | null; buildMs: number; warmMs: number }
        | null;
      lines.push(
        timings
          ? `Init timing     build ${timings.buildMs}ms · warm-up ${timings.warmMs}ms · simd=${timings.simd}`
          : 'Init timing     not loaded',
      );
      lines.push('');

      lines.push('--- Session summary ---');
      const summary = runtime.getSessionSummary();
      lines.push(summary ? JSON.stringify(summary, null, 2) : 'no session');
      lines.push('');

      lines.push(`--- Last ${MAX_EVENTS} events ---`);
      lines.push(
        events.length === 0
          ? '(none)'
          : events.map((e) => `${(e.at / 1000).toFixed(1).padStart(7)}s  ${e.text}`).join('\n'),
      );
      lines.push('');

      lines.push('--- Errors ---');
      lines.push(errors.length === 0 ? '(none)' : errors.join('\n'));

      return lines.join('\n');
    },
  };
}

/**
 * Copy to clipboard with a fallback.
 *
 * `navigator.clipboard` needs a secure context and, on iOS, a live user gesture —
 * so this must be called synchronously from the tap handler, not after an await.
 * Where it is unavailable the textarea path still works.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through — permissions policy or a stale gesture.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // Off-screen but focusable. `display:none` would make selection fail.
    area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length); // iOS ignores select() alone
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
