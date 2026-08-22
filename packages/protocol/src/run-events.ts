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
  Object.fromEntries(RUN_ID_KINDS.map((kind) => [kind, new RegExp(`^${kind}:${UUID}$`, 'u')])) as Record<RunIdKind, RegExp>,
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
  const crypto = (globalThis as { readonly crypto?: { randomUUID?: () => string; getRandomValues?<T extends ArrayBufferView>(value: T): T } }).crypto;
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
  if (performance === undefined) throw new Error('a monotonic clock is unavailable; pass monotonicNow');
  return performance.now();
}

export const RUN_EVENT_CLASSES = Object.freeze(['authoritative', 'state', 'diagnostic'] as const);
export type RunEventClass = (typeof RUN_EVENT_CLASSES)[number];
export const RUN_EVENT_VERSION = 2 as const;

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

/** Version 2 is the only accepted event shape; there is no legacy envelope. */
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
  | 'causal-cycle';

export type RunEventValidationResult =
  | { readonly ok: true; readonly value: RunEvent }
  | { readonly ok: false; readonly code: RunEventViolationCode; readonly detail: string };

type RunEventFailure = Extract<RunEventValidationResult, { readonly ok: false }>;

export interface CreateRunEventInput<
  Type extends string,
  Payload extends RunEventJson,
> {
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
  readonly #ids: RunIdFactory;
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
    if (!nonNegativeInteger(options.epoch)) throw new TypeError('producer epoch must be a non-negative safe integer');
    parseRunId('producer', options.producerId);
    this.#producerId = options.producerId;
    this.#epoch = options.epoch;
    this.#ids = new RunIdFactory(options.randomUUID);
    this.#monotonicNow = options.monotonicNow ?? browserMonotonicNow;
    this.#wallNow = options.wallNow;
  }

  emit<Type extends string, Payload extends RunEventJson>(
    input: ProduceRunEventInput<Type, Payload>,
    limits: RunEventLimits = DEFAULT_RUN_EVENT_LIMITS,
  ): RunEvent<Type, Payload> {
    if (!Number.isSafeInteger(this.#seq)) throw new Error('producer sequence exhausted the safe integer range');
    const now = this.#monotonicNow();
    if (!time(now) || now < this.#lastTime) throw new Error('producer monotonic clock moved backwards');
    const event = createRunEvent({
      eventId: this.#ids.create('event'),
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
    }, limits);
    this.#seq += 1;
    this.#lastTime = now;
    return event;
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
  if (!isRecord(event) || event['v'] !== RUN_EVENT_VERSION) return fail('invalid-envelope', `v must be exactly ${RUN_EVENT_VERSION}`);
  const allowed = new Set(['v', 'eventId', 'producerId', 'epoch', 'seq', 'eventClass', 'type', 'monotonicTime', 'wallTime', 'identity', 'causedBy', 'payload']);
  if (Object.keys(event).some((key) => !allowed.has(key))) return fail('invalid-envelope', 'event contains an unknown field');
  if (!id('event', event['eventId'])) return fail('invalid-id', 'eventId is invalid');
  if (!id('producer', event['producerId'])) return fail('invalid-id', 'producerId is invalid');
  if (!nonNegativeInteger(event['epoch'])) return fail('invalid-envelope', 'epoch must be a non-negative safe integer');
  if (!nonNegativeInteger(event['seq'])) return fail('invalid-envelope', 'seq must be a non-negative safe integer');
  if (!RUN_EVENT_CLASSES.includes(event['eventClass'] as RunEventClass)) return fail('invalid-envelope', 'eventClass is invalid');
  if (typeof event['type'] !== 'string' || !/^[a-z][a-z0-9]*(?:[./:-][a-z0-9]+)*$/u.test(event['type']) || utf8(event['type']) > 128) {
    return fail('invalid-envelope', 'type must be a bounded lowercase namespaced token');
  }
  if (!time(event['monotonicTime'])) return fail('invalid-envelope', 'monotonicTime must be a finite non-negative number');
  if (event['wallTime'] !== undefined && !time(event['wallTime'])) return fail('invalid-envelope', 'wallTime must be a finite non-negative number');
  const identityFailure = validateIdentity(event['identity']);
  if (identityFailure !== null) return identityFailure;
  if (event['causedBy'] !== undefined) {
    if (!Array.isArray(event['causedBy']) || event['causedBy'].length > limits.maxCauses) return fail('invalid-envelope', 'causedBy exceeds its bound');
    const causes = event['causedBy'];
    if (causes.some((cause) => !id('event', cause))) return fail('invalid-id', 'causedBy contains an invalid event id');
    if (new Set(causes).size !== causes.length) return fail('invalid-envelope', 'causedBy contains duplicates');
    if (causes.includes(event['eventId'])) return fail('causal-cycle', 'an event cannot cause itself');
  }
  const bytes = utf8(JSON.stringify(event));
  if (bytes > limits.maxEventBytes) return fail('event-oversized', `event is ${bytes} bytes, ceiling is ${limits.maxEventBytes}`);
  return { ok: true, value: event as unknown as RunEvent };
}

/** Stateful collision, ordering and causal-DAG validator for merged streams. */
export class RunEventStreamValidator {
  readonly #limits: RunEventLimits;
  readonly #eventIds = new Set<string>();
  readonly #sequenceKeys = new Set<string>();
  readonly #producerEpoch = new Map<string, number>();
  readonly #last = new Map<string, { readonly seq: number; readonly monotonicTime: number }>();
  readonly #causes = new Map<string, readonly string[]>();

  constructor(limits: RunEventLimits = DEFAULT_RUN_EVENT_LIMITS) {
    const failure = validateLimits(limits);
    if (failure !== null) throw new TypeError(failure.detail);
    this.#limits = limits;
  }

  accept(value: unknown): RunEventValidationResult {
    const parsed = validateRunEvent(value, this.#limits);
    if (!parsed.ok) return parsed;
    const event = parsed.value;
    if (this.#eventIds.has(event.eventId)) return fail('event-collision', `event id ${event.eventId} was already observed`);
    const sequenceKey = `${event.producerId}/${event.epoch}/${event.seq}`;
    if (this.#sequenceKeys.has(sequenceKey)) return fail('event-collision', 'producer epoch/sequence was already observed');
    const newestEpoch = this.#producerEpoch.get(event.producerId);
    if (newestEpoch !== undefined && event.epoch < newestEpoch) return fail('epoch-regression', 'producer epoch moved backwards');
    const incarnation = `${event.producerId}/${event.epoch}`;
    const previous = this.#last.get(incarnation);
    if (previous !== undefined && event.seq <= previous.seq) return fail('sequence-regression', 'producer sequence did not increase');
    if (previous !== undefined && event.monotonicTime < previous.monotonicTime) return fail('monotonic-time-regression', 'producer monotonic time moved backwards');

    const causes = event.causedBy ?? [];
    this.#causes.set(event.eventId, causes);
    if (this.#hasCycle(event.eventId)) {
      this.#causes.delete(event.eventId);
      return fail('causal-cycle', 'causedBy introduces a cycle');
    }
    this.#eventIds.add(event.eventId);
    this.#sequenceKeys.add(sequenceKey);
    this.#producerEpoch.set(event.producerId, Math.max(newestEpoch ?? event.epoch, event.epoch));
    this.#last.set(incarnation, { seq: event.seq, monotonicTime: event.monotonicTime });
    return parsed;
  }

  #hasCycle(start: string): boolean {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (idValue: string): boolean => {
      if (visiting.has(idValue)) return true;
      if (visited.has(idValue)) return false;
      visiting.add(idValue);
      for (const cause of this.#causes.get(idValue) ?? []) {
        if (visit(cause)) return true;
      }
      visiting.delete(idValue);
      visited.add(idValue);
      return false;
    };
    return visit(start);
  }
}

function validateIdentity(value: RunEventJson | undefined): RunEventFailure | null {
  if (!isRecord(value)) return fail('invalid-identity', 'identity must be an object');
  const fields = Object.freeze([
    ['invocationId', 'invocation'], ['runId', 'run'], ['projectId', 'project'], ['shardId', 'shard'],
    ['specId', 'spec'], ['runnerTaskId', 'runner-task'], ['executionId', 'execution'], ['attemptId', 'attempt'],
    ['sessionId', 'session'], ['stepId', 'step'], ['actionId', 'action'],
  ] as const);
  if (Object.keys(value).some((key) => !fields.some(([field]) => field === key))) return fail('invalid-identity', 'identity contains an unknown field');
  for (const [field, kind] of fields) {
    if ((field === 'invocationId' || value[field] !== undefined) && !id(kind, value[field])) return fail('invalid-id', `${field} is invalid`);
  }
  const needs = (child: string, parent: string): RunEventFailure | null =>
    value[child] !== undefined && value[parent] === undefined ? fail('invalid-identity', `${child} requires ${parent}`) : null;
  return needs('runId', 'invocationId')
    ?? needs('projectId', 'runId')
    ?? needs('shardId', 'runId')
    ?? needs('specId', 'projectId')
    ?? needs('runnerTaskId', 'specId')
    ?? needs('executionId', 'runnerTaskId')
    ?? needs('attemptId', 'executionId')
    ?? needs('sessionId', 'attemptId')
    ?? needs('stepId', 'attemptId')
    ?? needs('actionId', 'sessionId');
}

function validateLimits(limits: RunEventLimits): RunEventFailure | null {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) return fail('invalid-envelope', `${name} must be a positive safe integer`);
  }
  return null;
}

function projectJson(value: unknown, limits: RunEventLimits): { readonly ok: true; readonly value: RunEventJson } | RunEventFailure {
  let entries = 0;
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number): RunEventJson | RunEventFailure => {
    if (current === null || typeof current === 'boolean' || typeof current === 'string') {
      if (typeof current === 'string' && utf8(current) > limits.maxStringBytes) return fail('invalid-payload', 'a string exceeds maxStringBytes');
      return current;
    }
    if (typeof current === 'number') return Number.isFinite(current) ? current : fail('invalid-payload', 'numbers must be finite');
    if (typeof current !== 'object') return fail('invalid-payload', 'payload is not JSON data');
    if (depth > limits.maxPayloadDepth) return fail('invalid-payload', 'payload exceeds maxPayloadDepth');
    if (seen.has(current)) return fail('invalid-payload', 'payload aliases or cycles an object');
    seen.add(current);
    try {
      const symbols = Object.getOwnPropertySymbols(current);
      if (symbols.length > 0) return fail('invalid-payload', 'payload contains symbol keys');
      if (Array.isArray(current)) {
        if (Object.keys(current).length !== current.length) return fail('invalid-payload', 'payload contains a sparse array or extra array keys');
        const result: RunEventJson[] = [];
        for (const item of current) {
          entries += 1;
          if (entries > limits.maxPayloadEntries) return fail('invalid-payload', 'payload exceeds maxPayloadEntries');
          const child = visit(item, depth + 1);
          if (isFailure(child)) return child;
          result.push(child);
        }
        return Object.freeze(result);
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return fail('invalid-payload', 'payload object has a non-plain prototype');
      const result: Record<string, RunEventJson> = Object.create(null) as Record<string, RunEventJson>;
      for (const key of Object.keys(current)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') return fail('invalid-payload', 'payload contains a reserved key');
        if (utf8(key) > limits.maxStringBytes) return fail('invalid-payload', 'a payload key exceeds maxStringBytes');
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !('value' in descriptor)) return fail('invalid-payload', 'payload contains an accessor');
        entries += 1;
        if (entries > limits.maxPayloadEntries) return fail('invalid-payload', 'payload exceeds maxPayloadEntries');
        const child = visit(descriptor.value, depth + 1);
        if (isFailure(child)) return child;
        result[key] = child;
      }
      return Object.freeze(result);
    } catch {
      return fail('invalid-payload', 'payload object could not be inspected safely');
    }
  };
  const projected = visit(value, 0);
  return isFailure(projected) ? projected : { ok: true, value: projected };
}

function isRecord(value: RunEventJson | undefined): value is { readonly [key: string]: RunEventJson } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailure(value: RunEventJson | RunEventFailure): value is RunEventFailure {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'ok' in value && value.ok === false;
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
