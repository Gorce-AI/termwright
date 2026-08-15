/**
 * The session event backbone consumed by `@termwright/trace` and
 * `@termwright/ui`. Listeners are never awaited and a throwing listener never
 * breaks the session: it is reported through the diagnostics hook instead.
 */
import type { SessionEventMap, SessionEvents } from './api.js';

type Listener<E extends keyof SessionEventMap> = (payload: SessionEventMap[E]) => void;

/** Typed multicast emitter implementing the public {@link SessionEvents}. */
export class SessionEventEmitter implements SessionEvents {
  readonly #listeners = new Map<keyof SessionEventMap, Set<Listener<never>>>();
  readonly #onListenerError: (error: unknown) => void;

  constructor(onListenerError: (error: unknown) => void = () => {}) {
    this.#onListenerError = onListenerError;
  }

  on<E extends keyof SessionEventMap>(event: E, cb: (payload: SessionEventMap[E]) => void): () => void {
    let set = this.#listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    const listener = cb as Listener<never>;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** Delivers `payload` to every listener registered for `event`. */
  emit<E extends keyof SessionEventMap>(event: E, payload: SessionEventMap[E]): void {
    const set = this.#listeners.get(event);
    if (set === undefined) return;
    for (const listener of [...set]) {
      try {
        (listener as unknown as Listener<E>)(payload);
      } catch (error) {
        this.#onListenerError(error);
      }
    }
  }

  /** Drops every listener; called from `close()`. */
  clear(): void {
    this.#listeners.clear();
  }
}
