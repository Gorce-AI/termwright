import {
  RunEventProducer,
  RunEventStreamValidator,
  validateRunEvent,
  type InvocationId,
  type RunEvent,
  type RunEventId,
  type RunEventIdentity,
  type RunEventValidationResult,
  type RunId,
} from './run-events.js';

export interface RunEventJournalLimits {
  /** Lossless events are rejected with backpressure at this pending count. */
  readonly maxAuthoritativeEvents: number;
  /** Distinct coalescing keys pending between flushes. */
  readonly maxStateKeys: number;
  /** Diagnostic events retained; evictions produce an explicit gap event. */
  readonly maxDiagnosticEvents: number;
  /** Total owned serialized bytes pending across every event class. */
  readonly maxPendingBytes: number;
}

export const DEFAULT_RUN_EVENT_JOURNAL_LIMITS: RunEventJournalLimits = Object.freeze({
  maxAuthoritativeEvents: 10_000,
  maxStateKeys: 10_000,
  maxDiagnosticEvents: 1_000,
  maxPendingBytes: 16 * 1024 * 1024,
});

export interface RunEventFlushBarrier {
  readonly token: number;
  readonly highWaterMark: number;
}

export type RunEventJournalViolationCode =
  | Extract<RunEventValidationResult, { readonly ok: false }>['code']
  | 'stale-run'
  | 'journal-full'
  | 'state-key-required'
  | 'invalid-barrier';

export type RunEventJournalAppendResult =
  | { readonly ok: true; readonly ordinal: number }
  | { readonly ok: false; readonly code: RunEventJournalViolationCode; readonly detail: string };

interface JournalEntry {
  readonly ordinal: number;
  readonly event: RunEvent;
  readonly bytes: number;
  readonly stateKey?: string;
}

interface DiagnosticGap {
  readonly ordinal: number;
  count: number;
  readonly firstEventId: RunEventId;
  lastEventId: RunEventId;
  event?: RunEvent;
  bytes: number;
}

const DIAGNOSTIC_GAP_RESERVATION_BYTES = 4 * 1024;

/**
 * In-memory ordering core used by the first-class Termwright test host.
 *
 * Authoritative events are never dropped. State coalescing is explicit and is
 * stopped by every barrier. Diagnostics are bounded, and every eviction is
 * represented by a lossless synthetic `journal.diagnostic-gap` event.
 */
export class RunEventJournal {
  readonly #invocationId: InvocationId;
  readonly #runId: RunId;
  readonly #limits: RunEventJournalLimits;
  readonly #validator = new RunEventStreamValidator();
  readonly #gapProducer: RunEventProducer;
  readonly #gapIdentity: RunEventIdentity;
  readonly #entries: JournalEntry[] = [];
  readonly #currentState = new Map<string, JournalEntry>();
  readonly #gaps: DiagnosticGap[] = [];
  readonly #barriers = new Map<number, number>();
  readonly #counts: Record<RunEvent['eventClass'], number> = {
    authoritative: 0,
    state: 0,
    diagnostic: 0,
  };
  #openGap: DiagnosticGap | undefined;
  #nextOrdinal = 0;
  #nextBarrierToken = 0;
  #flushedThrough = -1;
  #sealedThrough = -1;
  #flushActive = false;
  #pendingBytes = 0;
  #peakPending = 0;
  #peakPendingBytes = 0;

  constructor(options: {
    readonly invocationId: InvocationId;
    readonly runId: RunId;
    readonly gapProducer: RunEventProducer;
    readonly limits?: RunEventJournalLimits;
  }) {
    this.#invocationId = options.invocationId;
    this.#runId = options.runId;
    this.#gapProducer = options.gapProducer;
    this.#gapIdentity = Object.freeze({ invocationId: options.invocationId, runId: options.runId });
    this.#limits = options.limits ?? DEFAULT_RUN_EVENT_JOURNAL_LIMITS;
    for (const [name, value] of Object.entries(this.#limits)) {
      if (!Number.isSafeInteger(value) || value < 1)
        throw new TypeError(`${name} must be a positive safe integer`);
    }
  }

  append(
    value: unknown,
    options: { readonly stateKey?: string } = {},
  ): RunEventJournalAppendResult {
    const parsed = validateRunEvent(value);
    if (!parsed.ok) return parsed;
    const event = parsed.value;
    if (
      event.identity.invocationId !== this.#invocationId ||
      event.identity.runId !== this.#runId
    ) {
      return failure('stale-run', 'event belongs to another invocation or run');
    }
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
    const previousState =
      event.eventClass === 'state' ? this.#currentState.get(options.stateKey!) : undefined;
    const bytesAfterReplacement = this.#pendingBytes - (previousState?.bytes ?? 0) + bytes;
    if (
      event.eventClass !== 'diagnostic' &&
      (bytes > this.#limits.maxPendingBytes || bytesAfterReplacement > this.#limits.maxPendingBytes)
    ) {
      return failure(
        'journal-full',
        `journal byte backlog would exceed ${this.#limits.maxPendingBytes} bytes`,
      );
    }
    if (event.eventClass === 'state' && !validStateKey(options.stateKey)) {
      return failure(
        'state-key-required',
        'state events require a bounded explicit coalescing key',
      );
    }
    if (
      event.eventClass === 'authoritative' &&
      this.#count('authoritative') >= this.#limits.maxAuthoritativeEvents
    ) {
      return failure(
        'journal-full',
        'authoritative queue is full; flush before accepting more events',
      );
    }
    if (
      event.eventClass === 'state' &&
      !this.#currentState.has(options.stateKey!) &&
      this.#currentState.size >= this.#limits.maxStateKeys
    ) {
      return failure(
        'journal-full',
        'state key queue is full; create a barrier and flush before accepting another key',
      );
    }
    const diagnosticsToDrop: JournalEntry[] = [];
    if (event.eventClass === 'diagnostic') {
      const candidates = this.#entries.filter(
        (candidate) =>
          candidate.event.eventClass === 'diagnostic' && candidate.ordinal > this.#sealedThrough,
      );
      let projectedCount = this.#count('diagnostic');
      let projectedBytes = this.#pendingBytes + bytes;
      for (const candidate of candidates) {
        const needsGapReservation = diagnosticsToDrop.length === 0 && this.#openGap === undefined;
        if (
          projectedCount < this.#limits.maxDiagnosticEvents &&
          projectedBytes <= this.#limits.maxPendingBytes
        )
          break;
        diagnosticsToDrop.push(candidate);
        projectedCount -= 1;
        projectedBytes -= candidate.bytes;
        if (needsGapReservation) projectedBytes += DIAGNOSTIC_GAP_RESERVATION_BYTES;
      }
      if (
        projectedCount >= this.#limits.maxDiagnosticEvents ||
        projectedBytes > this.#limits.maxPendingBytes
      ) {
        return failure(
          'journal-full',
          'diagnostic queue cannot reserve a loss marker within the byte/count bounds',
        );
      }
    }
    const ordered = this.#validator.accept(event);
    if (!ordered.ok) return ordered;

    const ordinal = this.#nextOrdinal;
    this.#nextOrdinal += 1;
    const entry = Object.freeze({
      ordinal,
      event,
      bytes,
      ...(options.stateKey === undefined ? {} : { stateKey: options.stateKey }),
    });
    if (event.eventClass === 'state') {
      const previous = previousState;
      if (previous !== undefined) this.#removeEntry(previous);
      this.#currentState.set(options.stateKey!, entry);
      this.#entries.push(entry);
      this.#pendingBytes += bytes;
      this.#counts.state += 1;
      this.#observePeak();
      return Object.freeze({ ok: true, ordinal });
    }
    if (event.eventClass === 'diagnostic') {
      for (const dropped of diagnosticsToDrop) {
        this.#removeEntry(dropped);
        this.#recordDiagnosticGap(dropped);
      }
    }
    this.#entries.push(entry);
    this.#pendingBytes += bytes;
    this.#counts[event.eventClass] += 1;
    this.#observePeak();
    return Object.freeze({ ok: true, ordinal });
  }

  /** Seals current coalescing and diagnostic-gap groups. */
  barrier(): RunEventFlushBarrier {
    this.#currentState.clear();
    this.#sealGap();
    const token = this.#nextBarrierToken;
    this.#nextBarrierToken += 1;
    const highWaterMark = this.#nextOrdinal - 1;
    this.#sealedThrough = Math.max(this.#sealedThrough, highWaterMark);
    this.#barriers.set(token, highWaterMark);
    return Object.freeze({ token, highWaterMark });
  }

  /**
   * Deliver everything through the barrier and remove it only after the sink
   * succeeds. A rejected sink leaves the exact batch available for retry.
   */
  async flushThrough(
    barrier: RunEventFlushBarrier,
    sink: (events: readonly RunEvent[]) => void | Promise<void>,
  ): Promise<readonly RunEvent[]> {
    if (this.#flushActive) {
      throw new RangeError('another journal flush is already in progress');
    }
    if (
      !Number.isSafeInteger(barrier.token) ||
      this.#barriers.get(barrier.token) !== barrier.highWaterMark ||
      !Number.isSafeInteger(barrier.highWaterMark) ||
      barrier.highWaterMark < this.#flushedThrough ||
      barrier.highWaterMark >= this.#nextOrdinal
    ) {
      throw new RangeError('flush barrier is stale, forged or beyond the journal high-water mark');
    }
    const ordinary = this.#entries.filter((entry) => entry.ordinal <= barrier.highWaterMark);
    const gaps = this.#gaps.filter((gap) => gap.ordinal <= barrier.highWaterMark);
    const batch = Object.freeze(
      [
        ...ordinary.map((entry) => ({ ordinal: entry.ordinal, event: entry.event })),
        ...gaps.map((gap) => ({ ordinal: gap.ordinal, event: gap.event! })),
      ]
        .sort((left, right) => left.ordinal - right.ordinal)
        .map(({ event }) => event),
    );
    this.#flushActive = true;
    try {
      await sink(batch);
    } finally {
      this.#flushActive = false;
    }
    const flushed = new Set(ordinary);
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      if (flushed.has(this.#entries[index]!)) {
        this.#pendingBytes -= this.#entries[index]!.bytes;
        this.#counts[this.#entries[index]!.event.eventClass] -= 1;
        this.#entries.splice(index, 1);
      }
    }
    const flushedGaps = new Set(gaps);
    for (let index = this.#gaps.length - 1; index >= 0; index -= 1) {
      if (flushedGaps.has(this.#gaps[index]!)) {
        this.#pendingBytes -= this.#gaps[index]!.bytes;
        this.#gaps.splice(index, 1);
      }
    }
    this.#flushedThrough = barrier.highWaterMark;
    for (const [token, highWaterMark] of this.#barriers) {
      if (highWaterMark <= barrier.highWaterMark) this.#barriers.delete(token);
    }
    return batch;
  }

  get pending(): number {
    // An open diagnostic gap is not flushable until a barrier seals it, but it
    // is still durable journal work and must be visible to backpressure/polling
    // consumers. Counting it prevents an apparently empty journal from hiding
    // a dropped diagnostic before the next flush barrier is created.
    return this.#entries.length + this.#gaps.length + (this.#openGap === undefined ? 0 : 1);
  }

  get pendingBytes(): number {
    return this.#pendingBytes;
  }

  get peakPending(): number {
    return this.#peakPending;
  }

  get peakPendingBytes(): number {
    return this.#peakPendingBytes;
  }

  #count(eventClass: RunEvent['eventClass']): number {
    return this.#counts[eventClass];
  }

  #removeEntry(entry: JournalEntry): void {
    const index = this.#entries.indexOf(entry);
    if (index >= 0) {
      this.#entries.splice(index, 1);
      this.#pendingBytes -= entry.bytes;
      this.#counts[entry.event.eventClass] -= 1;
    }
  }

  #recordDiagnosticGap(dropped: JournalEntry): void {
    if (this.#openGap === undefined) {
      this.#openGap = {
        ordinal: dropped.ordinal,
        count: 1,
        firstEventId: dropped.event.eventId,
        lastEventId: dropped.event.eventId,
        bytes: DIAGNOSTIC_GAP_RESERVATION_BYTES,
      };
      this.#pendingBytes += DIAGNOSTIC_GAP_RESERVATION_BYTES;
      this.#observePeak();
      return;
    }
    this.#openGap.count += 1;
    this.#openGap.lastEventId = dropped.event.eventId;
  }

  #sealGap(): void {
    const gap = this.#openGap;
    if (gap === undefined) return;
    gap.event = this.#gapProducer.emit({
      eventClass: 'diagnostic',
      type: 'journal.diagnostic-gap',
      identity: this.#gapIdentity,
      causedBy: [gap.lastEventId],
      payload: Object.freeze({
        dropped: gap.count,
        firstEventId: gap.firstEventId,
        lastEventId: gap.lastEventId,
      }),
    });
    const bytes = Buffer.byteLength(JSON.stringify(gap.event), 'utf8');
    if (bytes > DIAGNOSTIC_GAP_RESERVATION_BYTES) {
      throw new RangeError('journal diagnostic gap exceeded its byte reservation');
    }
    this.#pendingBytes += bytes - gap.bytes;
    gap.bytes = bytes;
    this.#gaps.push(gap);
    this.#openGap = undefined;
  }

  #observePeak(): void {
    this.#peakPending = Math.max(this.#peakPending, this.pending);
    this.#peakPendingBytes = Math.max(this.#peakPendingBytes, this.#pendingBytes);
  }
}

function validStateKey(value: string | undefined): value is string {
  return value !== undefined && /^[a-zA-Z0-9][a-zA-Z0-9./:_-]{0,255}$/u.test(value);
}

function failure(
  code: RunEventJournalViolationCode,
  detail: string,
): Extract<RunEventJournalAppendResult, { readonly ok: false }> {
  return Object.freeze({ ok: false, code, detail });
}
