/**
 * The session event backbone consumed by `@termwright/trace` and
 * `@termwright/ui`. Listeners are never awaited and a throwing listener never
 * breaks the session: it is reported through the diagnostics hook instead.
 */
import { CapacityError } from './errors.js';
import type {
  SessionEventGap,
  SessionEventMap,
  SessionEventRecord,
  SessionEvents,
  SessionEventSubscriptionOptions,
} from './api.js';

type Listener<E extends keyof SessionEventMap> = (payload: SessionEventMap[E]) => void;
type JournalListener = (record: SessionEventRecord) => void;

const MAX_JOURNAL_EVENTS = 8_192;
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;

/** Typed multicast emitter implementing the public {@link SessionEvents}. */
export class SessionEventEmitter implements SessionEvents {
  readonly #listeners = new Map<keyof SessionEventMap, Set<Listener<never>>>();
  readonly #journalListeners = new Set<JournalListener>();
  /** Subscribers that report their own delivery failures instead of the emitter. */
  readonly #journalListenerErrors = new WeakMap<
    JournalListener,
    (error: unknown, record: SessionEventRecord) => void
  >();
  readonly #journal: { readonly record: SessionEventRecord; readonly bytes: number }[] = [];
  readonly #onListenerError: (error: unknown) => void;
  #sequence = 0;
  #journalBytes = 0;
  #evictedBytes = 0;

  constructor(onListenerError: (error: unknown) => void = () => {}) {
    this.#onListenerError = onListenerError;
  }

  on<E extends keyof SessionEventMap>(
    event: E,
    cb: (payload: SessionEventMap[E]) => void,
  ): () => void {
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

  checkpoint(): number {
    return this.#sequence;
  }

  subscribe(options: SessionEventSubscriptionOptions, cb: JournalListener): () => void {
    if (!Number.isSafeInteger(options.fromSequence) || options.fromSequence <= 0) {
      throw new TypeError('session event fromSequence must be a positive safe integer');
    }
    const highWater = this.#sequence;
    const firstAvailable = this.#journal[0]?.record.sequence ?? highWater + 1;
    if (options.fromSequence < firstAvailable) {
      const gap: SessionEventGap = Object.freeze({
        requestedSequence: options.fromSequence,
        firstAvailableSequence: firstAvailable,
        lastLostSequence: firstAvailable - 1,
        lostEvents: firstAvailable - options.fromSequence,
        lostBytes: this.#evictedBytes,
      });
      if (options.onGap === undefined) {
        throw new CapacityError(
          `session event journal no longer retains sequences ${gap.requestedSequence}..${gap.lastLostSequence}`,
          {
            semanticTree: false,
            suggestion:
              'attach the authoritative sink before the journal reaches its bounded capacity',
          },
        );
      }
      options.onGap(gap);
    }

    // Arm before replay. A callback may synchronously cause another driver
    // event; buffer that re-entrant live suffix until the retained prefix has
    // been delivered, so source sequence never goes backwards.
    let replaying = true;
    const pending: SessionEventRecord[] = [];
    const listener: JournalListener = (record) => {
      if (record.sequence < options.fromSequence) return;
      if (replaying) pending.push(record);
      else cb(record);
    };
    this.#journalListeners.add(listener);
    if (options.onError !== undefined) this.#journalListenerErrors.set(listener, options.onError);
    try {
      for (const entry of this.#journal) {
        if (entry.record.sequence < options.fromSequence || entry.record.sequence > highWater)
          continue;
        cb(entry.record);
      }
      replaying = false;
      for (const record of pending) cb(record);
    } catch (error) {
      this.#journalListeners.delete(listener);
      throw error;
    }
    return () => this.#journalListeners.delete(listener);
  }

  /** Delivers `payload` to every listener registered for `event`. */
  emit<E extends keyof SessionEventMap>(event: E, payload: SessionEventMap[E]): void {
    const record = Object.freeze({
      sequence: ++this.#sequence,
      type: event,
      payload,
    }) as SessionEventRecord;
    const bytes = eventBytes(event, payload);
    this.#journal.push({ record, bytes });
    this.#journalBytes += bytes;
    while (this.#journal.length > MAX_JOURNAL_EVENTS || this.#journalBytes > MAX_JOURNAL_BYTES) {
      const removed = this.#journal.shift();
      if (removed === undefined) break;
      this.#journalBytes -= removed.bytes;
      this.#evictedBytes += removed.bytes;
    }

    for (const listener of [...this.#journalListeners]) {
      try {
        listener(record);
      } catch (error) {
        const owned = this.#journalListenerErrors.get(listener);
        if (owned === undefined) this.#onListenerError(error);
        else owned(error, record);
      }
    }
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
    this.#journalListeners.clear();
  }
}

function eventBytes<E extends keyof SessionEventMap>(
  event: E,
  payload: SessionEventMap[E],
): number {
  if (event === 'output' || event === 'input') {
    return (payload as SessionEventMap['output'] | SessionEventMap['input']).data.byteLength + 64;
  }
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8') + 64;
  } catch {
    return 256;
  }
}
