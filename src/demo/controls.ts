import type { PresenceConfig } from '../core/config.js';

interface Knob {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Every knob in PresenceConfig that is worth moving with a camera running. */
const KNOBS: Knob[] = [
  { path: 'targetFps', label: 'Target fps', min: 1, max: 30, step: 1 },
  { path: 'minFaceConfidence', label: 'Min face confidence', min: 0, max: 1, step: 0.05 },
  { path: 'bufferWindowMs', label: 'Buffer window (ms)', min: 500, max: 6000, step: 100 },
  { path: 'absenceEnterRatio', label: 'Absence enter ratio', min: 0, max: 1, step: 0.05 },
  { path: 'presenceRecoverRatio', label: 'Presence recover ratio', min: 0, max: 1, step: 0.05 },
  { path: 'absenceGraceMs', label: 'Absence grace (ms)', min: 0, max: 15000, step: 250 },
  { path: 'recoveryConfirmMs', label: 'Recovery confirm (ms)', min: 0, max: 5000, step: 100 },
  { path: 'absenceTimeoutMs', label: 'Absence timeout (ms)', min: 5000, max: 180000, step: 1000 },
  { path: 'multiFaceGraceMs', label: 'Multi-face grace (ms)', min: 0, max: 20000, step: 500 },
  { path: 'lowLightLumaThreshold', label: 'Low-light luma', min: 0, max: 255, step: 1 },
  { path: 'liveness.windowMs', label: 'Liveness window (ms)', min: 5000, max: 60000, step: 1000 },
  { path: 'liveness.blinkThreshold', label: 'Blink threshold', min: 0, max: 1, step: 0.05 },
  { path: 'liveness.minBlinksPerWindow', label: 'Min blinks / window', min: 0, max: 20, step: 1 },
  { path: 'liveness.minPoseVariance', label: 'Min pose variance', min: 0, max: 10, step: 0.1 },
];

/**
 * TODO(IC-31): persist tuned values to localStorage so a tuning session survives
 * a reload — otherwise every refresh loses the calibration work.
 */
export function mountControls(container: HTMLElement, config: PresenceConfig): void {
  for (const knob of KNOBS) {
    const value = read(config, knob.path);
    const row = document.createElement('label');
    row.className = 'control';
    row.innerHTML = `
      <span class="control__label">${knob.label}</span>
      <input type="range" min="${knob.min}" max="${knob.max}" step="${knob.step}" value="${value}" />
      <output class="control__value">${value}</output>`;

    const input = row.querySelector('input')!;
    const output = row.querySelector('output')!;
    input.addEventListener('input', () => {
      const next = Number(input.value);
      output.textContent = String(next);
      write(config, knob.path, next);
    });
    container.append(row);
  }
}

function read(config: PresenceConfig, path: string): number {
  return path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], config) as number;
}

function write(config: PresenceConfig, path: string, value: number): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>(
    (acc, key) => acc[key] as Record<string, unknown>,
    config as unknown as Record<string, unknown>,
  );
  target[last] = value;
}
