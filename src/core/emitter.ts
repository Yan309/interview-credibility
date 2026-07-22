import type { PresenceEvent, PresenceEventType } from './types.js';

export type Unsubscribe = () => void;
type Handler<T extends PresenceEvent = PresenceEvent> = (event: T) => void;

/** Minimal typed emitter — no dependency, so the core stays framework-agnostic. */
export class PresenceEmitter {
  private any: Set<Handler> = new Set();
  private byType = new Map<PresenceEventType, Set<Handler>>();

  /** Subscribe to every event. */
  on(handler: Handler): Unsubscribe;
  /** Subscribe to one event type, narrowed. */
  on<T extends PresenceEventType>(
    type: T,
    handler: Handler<Extract<PresenceEvent, { type: T }>>,
  ): Unsubscribe;
  on(a: PresenceEventType | Handler, b?: Handler): Unsubscribe {
    if (typeof a === 'function') {
      this.any.add(a);
      return () => this.any.delete(a);
    }
    const handler = b as Handler;
    const set = this.byType.get(a) ?? new Set<Handler>();
    set.add(handler);
    this.byType.set(a, set);
    return () => set.delete(handler);
  }

  emit(event: PresenceEvent): void {
    for (const handler of this.byType.get(event.type) ?? []) safely(handler, event);
    for (const handler of this.any) safely(handler, event);
  }

  emitAll(events: PresenceEvent[]): void {
    for (const event of events) this.emit(event);
  }

  clear(): void {
    this.any.clear();
    this.byType.clear();
  }
}

/** A throwing subscriber in the host app must not take down the detection loop. */
function safely(handler: Handler, event: PresenceEvent): void {
  try {
    handler(event);
  } catch (error) {
    console.error('[presence] event handler threw', error);
  }
}
