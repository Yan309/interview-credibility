import type { PresenceEvent } from '../core/index.js';

const SEVERITY: Partial<Record<PresenceEvent['type'], string>> = {
  'absence:started': 'warn',
  'absence:timeout': 'error',
  'camera:error': 'error',
  'liveness:suspect': 'warn',
  'multiface:detected': 'warn',
  'quality:degraded': 'warn',
};

const MAX_ROWS = 200;

export function mountEventLog(list: HTMLElement): (event: PresenceEvent) => void {
  return (event) => {
    const row = document.createElement('li');
    row.className = `event event--${SEVERITY[event.type] ?? 'info'}`;

    const { type, at, ...rest } = event;
    const detail = Object.keys(rest).length > 0 ? JSON.stringify(rest) : '';
    row.innerHTML = `
      <time>${(at / 1000).toFixed(1)}s</time>
      <code>${type}</code>
      <span class="event__detail">${detail}</span>`;

    list.prepend(row);
    while (list.childElementCount > MAX_ROWS) list.lastElementChild?.remove();
  };
}
