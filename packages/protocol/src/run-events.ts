/**
 * Browser-safe identity and event envelope for one Termwright invocation.
 *
 * These identifiers describe orchestration, not framework semantics.  Every
 * kind has a distinct wire prefix, so an execution id can never be accepted as
 * an attempt id merely because both happen to contain the same random bits.
 */

export const RUN_ID_KINDS = Object.freeze([
  'invocation',
  'run',
  'project',
  'shard',
  'spec',
  'runner-task',
  'execution',
  'attempt',
  'session',
  'step',
  'action',
  'producer',
  'event',
] as const);

export type RunIdKind = (typeof RUN_ID_KINDS)[number];

declare const runIdBrand: unique symbol;
type BrandedRunId<Kind extends RunIdKind> = string & {
  readonly [runIdBrand]: Kind;
};

export type InvocationId = BrandedRunId<'invocation'>;
export type RunId = BrandedRunId<'run'>;
export type ProjectId = BrandedRunId<'project'>;
export type ShardId = BrandedRunId<'shard'>;
export type SpecId = BrandedRunId<'spec'>;
export type RunnerTaskId = BrandedRunId<'runner-task'>;
export type ExecutionId = BrandedRunId<'execution'>;
export type AttemptId = BrandedRunId<'attempt'>;
export type SessionId = BrandedRunId<'session'>;
export type StepId = BrandedRunId<'step'>;
export type ActionId = BrandedRunId<'action'>;
export type RunEventProducerId = BrandedRunId<'producer'>;
export type RunEventId = BrandedRunId<'event'>;

export interface RunIdByKind {
  readonly invocation: InvocationId;
  readonly run: RunId;
  readonly project: ProjectId;
  readonly shard: ShardId;
  readonly spec: SpecId;
  readonly 'runner-task': RunnerTaskId;
  readonly execution: ExecutionId;
  readonly attempt: AttemptId;
  readonly session: SessionId;
  readonly step: StepId;
  readonly action: ActionId;
  readonly producer: RunEventProducerId;
  readonly event: RunEventId;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ID_PATTERNS: Readonly<Record<RunIdKind, RegExp>> = Object.freeze(
  Object.fromEntries(
    RUN_ID_KINDS.map((kind) => [kind, new RegExp(`^${kind}:${UUID}$`, 'u')]),
  ) as Record<RunIdKind, RegExp>,
);

/** Validate and brand an id received from an untrusted or persisted source. */
export function parseRunId<Kind extends RunIdKind>(kind: Kind, value: unknown): RunIdByKind[Kind] {
  if (typeof value !== 'string' || !ID_PATTERNS[kind].test(value)) {
    throw new TypeError(`${kind} id must use the canonical ${kind}:<uuid-v4> form`);
  }
  return value as RunIdByKind[Kind];
}

/**
 * Mint a collision-resistant, kind-separated id without importing Node APIs.
 * `randomUUID` is injectable for deterministic tests and embedded runtimes.
 */
export function createRunId<Kind extends RunIdKind>(
  kind: Kind,
  randomUUID: () => string = browserRandomUuid,
): RunIdByKind[Kind] {
  const uuid = randomUUID().toLowerCase();
  return parseRunId(kind, `${kind}:${uuid}`);
}

/** Scoped issuer that detects a broken randomness source before ids escape. */
export class RunIdFactory {
  readonly #randomUUID: () => string;
  readonly #issued = new Set<string>();

  constructor(randomUUID: () => string = browserRandomUuid) {
    this.#randomUUID = randomUUID;
  }

  create<Kind extends RunIdKind>(kind: Kind): RunIdByKind[Kind] {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const value = createRunId(kind, this.#randomUUID);
      if (!this.#issued.has(value)) {
        this.#issued.add(value);
        return value;
      }
    }
    throw new Error('secure id source produced eight collisions');
  }
}

function browserRandomUuid(): string {
  const crypto = (
    globalThis as {
      readonly crypto?: {
        randomUUID?: () => string;
        getRandomValues?<T extends ArrayBufferView>(value: T): T;
      };
    }
  ).crypto;
  if (crypto?.randomUUID !== undefined) return crypto.randomUUID();
  if (crypto?.getRandomValues === undefined) {
    throw new Error('secure randomness is unavailable; pass an explicit randomUUID function');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function browserMonotonicNow(): number {
  const performance = (globalThis as { readonly performance?: { now(): number } }).performance;
  if (performance === undefined)
    throw new Error('a monotonic clock is unavailable; pass monotonicNow');
  return performance.now();
}

export const RUN_EVENT_CLASSES = Object.freeze(['authoritative', 'state', 'diagnostic'] as const);
export type RunEventClass = (typeof RUN_EVENT_CLASSES)[number];
export const RUN_EVENT_VERSION = 3 as const;

export type RunEventJson =
  | null
  | boolean
  | number
  | string
  | readonly RunEventJson[]
  | { readonly [key: string]: RunEventJson };

/** Hierarchical identity carried by every event. */
export interface RunEventIdentity {
  readonly invocationId: InvocationId;
  readonly runId?: RunId;
  readonly projectId?: ProjectId;
  readonly shardId?: ShardId;
  readonly specId?: SpecId;
  readonly runnerTaskId?: RunnerTaskId;
  readonly executionId?: ExecutionId;
  readonly attemptId?: AttemptId;
  readonly sessionId?: SessionId;
  readonly stepId?: StepId;
  readonly actionId?: ActionId;
}

/** Version 3 is the only accepted event shape; there is no legacy envelope. */
export interface RunEvent<
  Type extends string = string,
  Payload extends RunEventJson = RunEventJson,
> {
  readonly v: typeof RUN_EVENT_VERSION;
  readonly eventId: RunEventId;
  readonly producerId: RunEventProducerId;
  /** Producer incarnation. A restarted producer increments this value. */
  readonly epoch: number;
  /** Strictly increasing within one producer incarnation. */
  readonly seq: number;
  readonly eventClass: RunEventClass;
  readonly type: Type;
  /** Milliseconds from the producer's monotonic clock. */
  readonly monotonicTime: number;
  /** Optional Unix epoch milliseconds, for human correlation only. */
  readonly wallTime?: number;
  readonly identity: RunEventIdentity;
  readonly causedBy?: readonly RunEventId[];
  readonly payload: Payload;
}

export interface RunEventLimits {
  readonly maxEventBytes: number;
  readonly maxPayloadDepth: number;
  readonly maxPayloadEntries: number;
  readonly maxStringBytes: number;
  readonly maxCauses: number;
}

export const DEFAULT_RUN_EVENT_LIMITS: RunEventLimits = Object.freeze({
  maxEventBytes: 256 * 1024,
  maxPayloadDepth: 32,
  maxPayloadEntries: 10_000,
  maxStringBytes: 16 * 1024,
  maxCauses: 64,
});

export type RunEventViolationCode =
  | 'invalid-envelope'
  | 'invalid-id'
  | 'invalid-identity'
  | 'invalid-payload'
  | 'event-oversized'
  | 'event-collision'
  | 'epoch-regression'
  | 'sequence-regression'
  | 'monotonic-time-regression'
  | 'causal-cycle'
  | 'causal-reference-unavailable'
  | 'stream-capacity';

export type RunEventValidationResult =
  | { readonly ok: true; readonly value: RunEvent }
  | { readonly ok: false; readonly code: RunEventViolationCode; readonly detail: string };

type RunEventFailure = Extract<RunEventValidationResult, { readonly ok: false }>;

export interface CreateRunEventInput<Type extends string, Payload extends RunEventJson> {
  readonly eventId?: RunEventId;
  readonly producerId: RunEventProducerId;
  readonly epoch: number;
  readonly seq: number;
  readonly eventClass: RunEventClass;
  readonly type: Type;
  readonly monotonicTime: number;
  readonly wallTime?: number;
  readonly identity: RunEventIdentity;
  readonly causedBy?: readonly RunEventId[];
  readonly payload: Payload;
  readonly randomUUID?: () => string;
}

export interface ProduceRunEventInput<Type extends string, Payload extends RunEventJson> {
  readonly eventClass: RunEventClass;
  readonly type: Type;
  readonly identity: RunEventIdentity;
  readonly causedBy?: readonly RunEventId[];
  readonly payload: Payload;
}

/**
 * Producer-side constructor owning epoch, sequence, event ids and clock.
 * Callers therefore cannot accidentally reuse a journal coordinate.
 */
export class RunEventProducer {
  readonly #producerId: RunEventProducerId;
  readonly #epoch: number;
  readonly #randomUUID: () => string;
  readonly #recentEventIds = new RecentEventIds(4_096);
  readonly #monotonicNow: () => number;
  readonly #wallNow: (() => number) | undefined;
  #seq = 0;
  #lastTime = 0;

  constructor(options: {
    readonly producerId: RunEventProducerId;
    readonly epoch: number;
    readonly randomUUID?: () => string;
    readonly monotonicNow?: () => number;
    readonly wallNow?: () => number;
  }) {
    if (!nonNegativeInteger(options.epoch))
      throw new TypeError('producer epoch must be a non-negative safe integer');
    parseRunId('producer', options.producerId);
    this.#producerId = options.producerId;
    this.#epoch = options.epoch;
    this.#randomUUID = options.randomUUID ?? browserRandomUuid;
    this.#monotonicNow = options.monotonicNow ?? browserMonotonicNow;
    this.#wallNow = options.wallNow;
  }

  emit<Type extends string, Payload extends RunEventJson>(
    input: ProduceRunEventInput<Type, Payload>,
    limits: RunEventLimits = DEFAULT_RUN_EVENT_LIMITS,
  ): RunEvent<Type, Payload> {
    if (!Number.isSafeInteger(this.#seq))
      throw new Error('producer sequence exhausted the safe integer range');
    const now = this.#monotonicNow();
    if (!time(now) || now < this.#lastTime)
      throw new Error('producer monotonic clock moved backwards');
    const event = createRunEvent(
      {
        eventId: this.#createEventId(),
        producerId: this.#producerId,
        epoch: this.#epoch,
        seq: this.#seq,
        eventClass: input.eventClass,
        type: input.type,
        monotonicTime: now,
        ...(this.#wallNow === undefined ? {} : { wallTime: this.#wallNow() }),
        identity: input.identity,
        ...(input.causedBy === undefined ? {} : { causedBy: input.causedBy }),
        payload: input.payload,
      },
      limits,
    );
    this.#seq += 1;
    this.#lastTime = now;
    return event;
  }

  #createEventId(): RunEventId {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const eventId = createRunId('event', this.#randomUUID);
      if (!this.#recentEventIds.has(eventId)) {
        this.#recentEventIds.add(eventId);
        return eventId;
      }
    }
    throw new Error('secure event id source collided with retained evidence eight times');
  }
}

/** Construct and validate one deeply immutable envelope. */
export function createRunEvent<Type extends string, Payload extends RunEventJson>(
  input: CreateRunEventInput<Type, Payload>,
  limits: RunEventLimits = DEFAULT_RUN_EVENT_LIMITS,
): RunEvent<Type, Payload> {
  const candidate = {
    v: RUN_EVENT_VERSION,
    eventId: input.eventId ?? createRunId('event', input.randomUUID),
    producerId: input.producerId,
    epoch: input.epoch,
    seq: input.seq,
    eventClass: input.eventClass,
    type: input.type,
    monotonicTime: input.monotonicTime,
    ...(input.wallTime === undefined ? {} : { wallTime: input.wallTime }),
    identity: input.identity,
    ...(input.causedBy === undefined ? {} : { causedBy: input.causedBy }),
    payload: input.payload,
  };
  const parsed = validateRunEvent(candidate, limits);
  if (!parsed.ok) throw new TypeError(`${parsed.code}: ${parsed.detail}`);
  return parsed.value as RunEvent<Type, Payload>;
}

/** Validate, copy and deeply freeze a single untrusted event. */
export function validateRunEvent(
  value: unknown,
  limits: RunEventLimits = DEFAULT_RUN_EVENT_LIMITS,
): RunEventValidationResult {
  const checkedLimits = validateLimits(limits);
  if (checkedLimits !== null) return checkedLimits;
  const projected = projectJson(value, limits);
  if (!projected.ok) return projected;
  const event = projected.value;
  if (!isRecord(event) || event['v'] !== RUN_EVENT_VERSION)
    return fail('invalid-envelope', `v must be exactly ${RUN_EVENT_VERSION}`);
  const allowed = new Set([
    'v',
    'eventId',
    'producerId',
    'epoch',
    'seq',
    'eventClass',
    'type',
    'monotonicTime',
    'wallTime',
    'identity',
    'causedBy',
    'payload',
  ]);
  if (Object.keys(event).some((key) => !allowed.has(key)))
    return fail('invalid-envelope', 'event contains an unknown field');
  if (!id('event', event['eventId'])) return fail('invalid-id', 'eventId is invalid');
  if (!id('producer', event['producerId'])) return fail('invalid-id', 'producerId is invalid');
  if (!nonNegativeInteger(event['epoch']))
    return fail('invalid-envelope', 'epoch must be a non-negative safe integer');
  if (!nonNegativeInteger(event['seq']))
    return fail('invalid-envelope', 'seq must be a non-negative safe integer');
  if (!RUN_EVENT_CLASSES.includes(event['eventClass'] as RunEventClass))
    return fail('invalid-envelope', 'eventClass is invalid');
  if (
    typeof event['type'] !== 'string' ||
    !/^[a-z][a-z0-9]*(?:[./:-][a-z0-9]+)*$/u.test(event['type']) ||
    utf8(event['type']) > 128
  ) {
    return fail('invalid-envelope', 'type must be a bounded lowercase namespaced token');
  }
  if (!time(event['monotonicTime']))
    return fail('invalid-envelope', 'monotonicTime must be a finite non-negative number');
  if (event['wallTime'] !== undefined && !time(event['wallTime']))
    return fail('invalid-envelope', 'wallTime must be a finite non-negative number');
  const identityFailure = validateIdentity(event['identity']);
  if (identityFailure !== null) return identityFailure;
  if (event['causedBy'] !== undefined) {
    if (!Array.isArray(event['causedBy']) || event['causedBy'].length > limits.maxCauses)
      return fail('invalid-envelope', 'causedBy exceeds its bound');
    const causes = event['causedBy'];
    if (causes.some((cause) => !id('event', cause)))
      return fail('invalid-id', 'causedBy contains an invalid event id');
    if (new Set(causes).size !== causes.length)
      return fail('invalid-envelope', 'causedBy contains duplicates');
    if (causes.includes(event['eventId']))
      return fail('causal-cycle', 'an event cannot cause itself');
  }
  const bytes = utf8(JSON.stringify(event));
  if (bytes > limits.maxEventBytes)
    return fail('event-oversized', `event is ${bytes} bytes, ceiling is ${limits.maxEventBytes}`);
  return { ok: true, value: event as unknown as RunEvent };
}

export interface RunEventStreamLimits {
  readonly maxEvents: number;
  readonly maxProducers: number;
  readonly maxRecentEventIds: number;
  readonly eventIdFilterBits: number;
  readonly eventIdFilterHashes: number;
}

export const DEFAULT_RUN_EVENT_STREAM_LIMITS: RunEventStreamLimits = Object.freeze({
  maxEvents: 1_000_000,
  maxProducers: 4_096,
  maxRecentEventIds: 65_536,
  eventIdFilterBits: 128 * 1024 * 1024,
  eventIdFilterHashes: 7,
});

/** Stateful, bounded collision, ordering and causal-DAG validator for merged streams. */
export class RunEventStreamValidator {
  readonly #limits: RunEventLimits;
  readonly #streamLimits: RunEventStreamLimits;
  readonly #eventIds: FixedEventIdFilter;
  readonly #recentEventIds: RecentEventIds;
  readonly #producerState = new Map<
    string,
    { readonly epoch: number; readonly seq: number; readonly monotonicTime: number }
  >();
  #acceptedEvents = 0;

  constructor(
    limits: RunEventLimits = DEFAULT_RUN_EVENT_LIMITS,
    streamLimits: RunEventStreamLimits = DEFAULT_RUN_EVENT_STREAM_LIMITS,
  ) {
    const failure = validateLimits(limits);
    if (failure !== null) throw new TypeError(failure.detail);
    validateStreamLimits(streamLimits);
    this.#limits = limits;
    this.#streamLimits = streamLimits;
    this.#eventIds = new FixedEventIdFilter(
      streamLimits.eventIdFilterBits,
      streamLimits.eventIdFilterHashes,
    );
    this.#recentEventIds = new RecentEventIds(streamLimits.maxRecentEventIds);
  }

  accept(value: unknown): RunEventValidationResult {
    const parsed = validateRunEvent(value, this.#limits);
    if (!parsed.ok) return parsed;
    const event = parsed.value;
    if (this.#acceptedEvents >= this.#streamLimits.maxEvents)
      return fail('stream-capacity', 'run event capacity is exhausted');
    if (this.#eventIds.maybeHas(event.eventId))
      return fail('event-collision', `event id ${event.eventId} collides with retained evidence`);
    const previous = this.#producerState.get(event.producerId);
    if (previous === undefined && this.#producerState.size >= this.#streamLimits.maxProducers) {
      return fail('stream-capacity', 'run event producer capacity is exhausted');
    }
    if (previous !== undefined && event.epoch < previous.epoch)
      return fail('epoch-regression', 'producer epoch moved backwards');
    if (previous !== undefined && event.epoch === previous.epoch && event.seq <= previous.seq)
      return fail('sequence-regression', 'producer sequence did not increase');
    if (
      previous !== undefined &&
      event.epoch === previous.epoch &&
      event.monotonicTime < previous.monotonicTime
    )
      return fail('monotonic-time-regression', 'producer monotonic time moved backwards');

    const causes = event.causedBy ?? [];
    for (const cause of causes) {
      if (!this.#recentEventIds.has(cause)) {
        return fail(
          'causal-reference-unavailable',
          `cause ${cause} was not observed within the bounded causal horizon`,
        );
      }
    }
    this.#eventIds.add(event.eventId);
    this.#recentEventIds.add(event.eventId);
    this.#producerState.set(event.producerId, {
      epoch: event.epoch,
      seq: event.seq,
      monotonicTime: event.monotonicTime,
    });
    this.#acceptedEvents += 1;
    return parsed;
  }
}

class FixedEventIdFilter {
  readonly #words: Uint32Array;
  readonly #bits: number;
  readonly #hashes: number;

  constructor(bits: number, hashes: number) {
    this.#bits = bits;
    this.#hashes = hashes;
    this.#words = new Uint32Array(bits / 32);
  }

  maybeHas(value: string): boolean {
    for (const index of this.#indexes(value)) {
      if ((this.#words[index >>> 5]! & (1 << (index & 31))) === 0) return false;
    }
    return true;
  }

  add(value: string): void {
    for (const index of this.#indexes(value)) this.#words[index >>> 5]! |= 1 << (index & 31);
  }

  #indexes(value: string): readonly number[] {
    const first = hashText(value, 0x811c9dc5);
    const step = hashText(value, 0x9e3779b9) | 1;
    return Array.from(
      { length: this.#hashes },
      (_, index) => ((first + Math.imul(index, step)) >>> 0) % this.#bits,
    );
  }
}

class RecentEventIds {
  readonly #values = new Set<string>();
  readonly #ring: string[];
  #start = 0;
  #size = 0;

  constructor(capacity: number) {
    this.#ring = new Array<string>(capacity);
  }

  has(value: string): boolean {
    return this.#values.has(value);
  }

  add(value: string): void {
    const index = (this.#start + this.#size) % this.#ring.length;
    if (this.#size === this.#ring.length) {
      this.#values.delete(this.#ring[index]!);
      this.#start = (this.#start + 1) % this.#ring.length;
    } else {
      this.#size += 1;
    }
    this.#ring[index] = value;
    this.#values.add(value);
  }
}

function hashText(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function validateStreamLimits(value: RunEventStreamLimits): void {
  if (
    !Number.isSafeInteger(value.maxProducers) ||
    value.maxProducers < 1 ||
    !Number.isSafeInteger(value.maxEvents) ||
    value.maxEvents < 1 ||
    !Number.isSafeInteger(value.maxRecentEventIds) ||
    value.maxRecentEventIds < 1 ||
    !Number.isSafeInteger(value.eventIdFilterBits) ||
    value.eventIdFilterBits < 32 ||
    value.eventIdFilterBits % 32 !== 0 ||
    !Number.isSafeInteger(value.eventIdFilterHashes) ||
    value.eventIdFilterHashes < 1 ||
    value.eventIdFilterHashes > 16
  ) {
    throw new TypeError(
      'run event stream limits must be positive, filter bits divisible by 32, and filter hashes at most 16',
    );
  }
}

function validateIdentity(value: RunEventJson | undefined): RunEventFailure | null {
  if (!isRecord(value)) return fail('invalid-identity', 'identity must be an object');
  const fields = Object.freeze([
    ['invocationId', 'invocation'],
    ['runId', 'run'],
    ['projectId', 'project'],
    ['shardId', 'shard'],
    ['specId', 'spec'],
    ['runnerTaskId', 'runner-task'],
    ['executionId', 'execution'],
    ['attemptId', 'attempt'],
    ['sessionId', 'session'],
    ['stepId', 'step'],
    ['actionId', 'action'],
  ] as const);
  if (Object.keys(value).some((key) => !fields.some(([field]) => field === key)))
    return fail('invalid-identity', 'identity contains an unknown field');
  for (const [field, kind] of fields) {
    if ((field === 'invocationId' || value[field] !== undefined) && !id(kind, value[field]))
      return fail('invalid-id', `${field} is invalid`);
  }
  const needs = (child: string, parent: string): RunEventFailure | null =>
    value[child] !== undefined && value[parent] === undefined
      ? fail('invalid-identity', `${child} requires ${parent}`)
      : null;
  return (
    needs('runId', 'invocationId') ??
    needs('projectId', 'runId') ??
    needs('shardId', 'runId') ??
    needs('specId', 'projectId') ??
    needs('runnerTaskId', 'specId') ??
    needs('executionId', 'runnerTaskId') ??
    needs('attemptId', 'executionId') ??
    needs('sessionId', 'attemptId') ??
    needs('stepId', 'attemptId') ??
    needs('actionId', 'sessionId')
  );
}

function validateLimits(limits: RunEventLimits): RunEventFailure | null {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      return fail('invalid-envelope', `${name} must be a positive safe integer`);
  }
  return null;
}

/**
 * Carries a rejection out of the projection walk.
 *
 * The walk cannot signal failure with a plain `{ok: false}` object: that is
 * indistinguishable from payload data of the same shape, and `action.finished`
 * carries exactly that — an `ok` field reporting whether the action succeeded.
 * A failed action therefore looked like a rejected projection, and the event
 * was thrown away with a message built from a code and detail that were never
 * there ("undefined: undefined"). A class cannot be forged by JSON data.
 */
class ProjectionFailure {
  constructor(readonly failure: RunEventFailure) {}
}

function reject(code: RunEventViolationCode, detail: string): ProjectionFailure {
  return new ProjectionFailure(fail(code, detail));
}

function projectJson(
  value: unknown,
  limits: RunEventLimits,
): { readonly ok: true; readonly value: RunEventJson } | RunEventFailure {
  let entries = 0;
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number): RunEventJson | ProjectionFailure => {
    if (current === null || typeof current === 'boolean' || typeof current === 'string') {
      if (typeof current === 'string' && utf8(current) > limits.maxStringBytes)
        return reject('invalid-payload', 'a string exceeds maxStringBytes');
      return current;
    }
    if (typeof current === 'number')
      return Number.isFinite(current)
        ? current
        : reject('invalid-payload', 'numbers must be finite');
    if (typeof current !== 'object') return reject('invalid-payload', 'payload is not JSON data');
    if (depth > limits.maxPayloadDepth)
      return reject('invalid-payload', 'payload exceeds maxPayloadDepth');
    if (seen.has(current)) return reject('invalid-payload', 'payload aliases or cycles an object');
    seen.add(current);
    try {
      const symbols = Object.getOwnPropertySymbols(current);
      if (symbols.length > 0) return reject('invalid-payload', 'payload contains symbol keys');
      if (Array.isArray(current)) {
        if (Object.keys(current).length !== current.length)
          return reject('invalid-payload', 'payload contains a sparse array or extra array keys');
        const result: RunEventJson[] = [];
        for (const item of current) {
          entries += 1;
          if (entries > limits.maxPayloadEntries)
            return reject('invalid-payload', 'payload exceeds maxPayloadEntries');
          const child = visit(item, depth + 1);
          if (child instanceof ProjectionFailure) return child;
          result.push(child);
        }
        return Object.freeze(result);
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null)
        return reject('invalid-payload', 'payload object has a non-plain prototype');
      const result: Record<string, RunEventJson> = Object.create(null) as Record<
        string,
        RunEventJson
      >;
      for (const key of Object.keys(current)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
          return reject('invalid-payload', 'payload contains a reserved key');
        if (utf8(key) > limits.maxStringBytes)
          return reject('invalid-payload', 'a payload key exceeds maxStringBytes');
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !('value' in descriptor))
          return reject('invalid-payload', 'payload contains an accessor');
        entries += 1;
        if (entries > limits.maxPayloadEntries)
          return reject('invalid-payload', 'payload exceeds maxPayloadEntries');
        const child = visit(descriptor.value, depth + 1);
        if (child instanceof ProjectionFailure) return child;
        result[key] = child;
      }
      return Object.freeze(result);
    } catch {
      return reject('invalid-payload', 'payload object could not be inspected safely');
    }
  };
  const projected = visit(value, 0);
  return projected instanceof ProjectionFailure
    ? projected.failure
    : { ok: true, value: projected };
}

function isRecord(
  value: RunEventJson | undefined,
): value is { readonly [key: string]: RunEventJson } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: RunEventViolationCode, detail: string): RunEventFailure {
  return Object.freeze({ ok: false, code, detail });
}

function id(kind: RunIdKind, value: RunEventJson | undefined): boolean {
  return typeof value === 'string' && ID_PATTERNS[kind].test(value);
}

function nonNegativeInteger(value: RunEventJson | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function time(value: RunEventJson | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function utf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
