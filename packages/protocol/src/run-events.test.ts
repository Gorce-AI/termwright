import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_EVENT_LIMITS,
  RUN_EVENT_CLASSES,
  RUN_ID_KINDS,
  RunEventProducer,
  RunEventStreamValidator,
  RunIdFactory,
  createRunEvent,
  createRunId,
  parseRunId,
  validateRunEvent,
  type RunEvent,
  type RunEventIdentity,
} from './run-events.js';

const UUIDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000007',
  '00000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000009',
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b',
] as const;

const invocationId = createRunId('invocation', () => UUIDS[0]);
const runId = createRunId('run', () => UUIDS[1]);
const projectId = createRunId('project', () => UUIDS[2]);
const specId = createRunId('spec', () => UUIDS[3]);
const runnerTaskId = createRunId('runner-task', () => UUIDS[4]);
const executionId = createRunId('execution', () => UUIDS[5]);
const attemptId = createRunId('attempt', () => UUIDS[6]);
const producerId = createRunId('producer', () => UUIDS[7]);

const identity: RunEventIdentity = Object.freeze({
  invocationId,
  runId,
  projectId,
  specId,
  runnerTaskId,
  executionId,
  attemptId,
});

function event(
  seq: number,
  overrides: Partial<RunEvent> = {},
): RunEvent {
  return createRunEvent({
    producerId,
    epoch: 0,
    seq,
    eventClass: 'authoritative',
    type: 'attempt.started',
    monotonicTime: seq * 10,
    identity,
    payload: { retry: 0 },
    randomUUID: () => UUIDS[8 + seq] ?? `00000000-0000-4000-8000-${String(seq + 1).padStart(12, '0')}`,
    ...overrides,
  });
}

describe('formal run identity', () => {
  it('uses disjoint canonical prefixes for every identity domain', () => {
    expect(new Set(RUN_ID_KINDS.map((kind, index) => createRunId(kind, () => UUIDS[index % UUIDS.length]!))).size)
      .toBe(RUN_ID_KINDS.length);
    expect(() => parseRunId('attempt', executionId)).toThrow(/attempt:<uuid-v4>/u);
    expect(parseRunId('execution', executionId)).toBe(executionId);
  });

  it('rejects weak, malformed and non-v4 randomness instead of minting a misleading id', () => {
    expect(() => createRunId('run', () => 'same-every-time')).toThrow();
    expect(() => createRunId('run', () => '00000000-0000-1000-8000-000000000000')).toThrow();
    expect(() => parseRunId('run', 'run:00000000-0000-4000-7000-000000000000')).toThrow();
  });

  it('detects repeated valid UUIDs in a scoped issuer', () => {
    const ids = new RunIdFactory(() => UUIDS[0]);
    expect(ids.create('run')).toBe(`run:${UUIDS[0]}`);
    expect(() => ids.create('run')).toThrow(/eight collisions/u);
  });
});

describe('RunEvent v2 envelope', () => {
  it('constructs one deeply immutable, browser-safe envelope', () => {
    const created = event(0);
    expect(created).toMatchObject({
      v: 2,
      producerId,
      epoch: 0,
      seq: 0,
      eventClass: 'authoritative',
      type: 'attempt.started',
      identity,
      payload: { retry: 0 },
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.identity)).toBe(true);
    expect(Object.isFrozen(created.payload)).toBe(true);
  });

  it.each(RUN_EVENT_CLASSES)('accepts the %s event class', (eventClass) => {
    expect(validateRunEvent(event(0, { eventClass })).ok).toBe(true);
  });

  it('keeps a payload whose own fields look like a validation failure', () => {
    // `action.finished` reports the action's outcome as `ok`, and a failed
    // action therefore carries `ok: false` — the same shape the projection
    // walk once used to signal its own rejection. The event was dropped and
    // the run later failed with a missing receipt and no reason.
    const failedAction = event(1, {
      type: 'action.finished',
      payload: { api: 'press', ok: false, error: 'the key was refused' },
    });

    expect(failedAction.payload).toEqual({ api: 'press', ok: false, error: 'the key was refused' });
    expect(event(2, { payload: { ok: false } }).payload).toEqual({ ok: false });
    expect(event(3, { payload: { nested: { ok: false, code: 'invalid-payload', detail: 'x' } } }).payload)
      .toEqual({ nested: { ok: false, code: 'invalid-payload', detail: 'x' } });
  });

  it('enforces identity ancestry rather than accepting detached attempt ids', () => {
    const broken = { ...event(0), identity: { invocationId, attemptId } };
    expect(validateRunEvent(broken)).toEqual({
      ok: false,
      code: 'invalid-identity',
      detail: 'attemptId requires executionId',
    });
  });

  it('rejects unknown envelope fields and unsupported versions', () => {
    expect(validateRunEvent({ ...event(0), v: 1 })).toMatchObject({ ok: false, code: 'invalid-envelope' });
    expect(validateRunEvent({ ...event(0), surprise: true })).toMatchObject({ ok: false, code: 'invalid-envelope' });
  });

  it('rejects a self cause, duplicate causes and excessive causal fan-in', () => {
    const current = event(0);
    expect(validateRunEvent({ ...current, causedBy: [current.eventId] })).toMatchObject({ ok: false, code: 'causal-cycle' });
    const cause = createRunId('event', () => UUIDS[10]);
    expect(validateRunEvent({ ...current, causedBy: [cause, cause] })).toMatchObject({ ok: false, code: 'invalid-envelope' });
    expect(validateRunEvent({ ...current, causedBy: Array.from({ length: 65 }, () => cause) })).toMatchObject({ ok: false, code: 'invalid-envelope' });
  });

  it('bounds hostile payload bytes, depth, entries, strings and non-JSON values', () => {
    const base = event(0);
    expect(validateRunEvent({ ...base, payload: { text: 'x'.repeat(20) } }, { ...DEFAULT_RUN_EVENT_LIMITS, maxStringBytes: 8 })).toMatchObject({ ok: false, code: 'invalid-payload' });
    expect(validateRunEvent({ ...base, payload: { a: { b: { c: true } } } }, { ...DEFAULT_RUN_EVENT_LIMITS, maxPayloadDepth: 2 })).toMatchObject({ ok: false, code: 'invalid-payload' });
    expect(validateRunEvent({ ...base, payload: [1, 2, 3] }, { ...DEFAULT_RUN_EVENT_LIMITS, maxPayloadEntries: 10 })).toMatchObject({ ok: false, code: 'invalid-payload' });
    expect(validateRunEvent({ ...base, payload: Number.NaN })).toMatchObject({ ok: false, code: 'invalid-payload' });
    expect(validateRunEvent({ ...base, payload: { x: 1 } }, { ...DEFAULT_RUN_EVENT_LIMITS, maxEventBytes: 32 })).toMatchObject({ ok: false, code: 'event-oversized' });
  });

  it('rejects accessors, aliases, cycles, sparse arrays and reserved keys without invoking getters', () => {
    let invoked = false;
    const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get: () => { invoked = true; return 'no'; } });
    expect(validateRunEvent({ ...event(0), payload: accessor })).toMatchObject({ ok: false, code: 'invalid-payload' });
    expect(invoked).toBe(false);
    const shared = { x: 1 };
    expect(validateRunEvent({ ...event(0), payload: [shared, shared] })).toMatchObject({ ok: false, code: 'invalid-payload' });
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(validateRunEvent({ ...event(0), payload: cycle })).toMatchObject({ ok: false, code: 'invalid-payload' });
    const sparse = new Array(2);
    sparse[1] = true;
    expect(validateRunEvent({ ...event(0), payload: sparse })).toMatchObject({ ok: false, code: 'invalid-payload' });
    const reserved = Object.create(null) as Record<string, unknown>;
    reserved['__proto__'] = true;
    expect(validateRunEvent({ ...event(0), payload: reserved })).toMatchObject({ ok: false, code: 'invalid-payload' });
  });
});

describe('merged RunEvent stream validation', () => {
  it('lets the authoritative producer own collision-free sequence and time', () => {
    let uuid = 20;
    let now = 10;
    const producer = new RunEventProducer({
      producerId,
      epoch: 4,
      randomUUID: () => `00000000-0000-4000-8000-${String(uuid++).padStart(12, '0')}`,
      monotonicNow: () => now++,
      wallNow: () => 1_800_000_000_000,
    });
    const first = producer.emit({ eventClass: 'authoritative', type: 'attempt.started', identity, payload: {} });
    const second = producer.emit({ eventClass: 'state', type: 'attempt.running', identity, payload: {} });
    expect([first.seq, second.seq]).toEqual([0, 1]);
    expect([first.monotonicTime, second.monotonicTime]).toEqual([10, 11]);
    expect(first.eventId).not.toBe(second.eventId);
  });

  it('refuses a regressing producer clock before publishing an event', () => {
    const times = [10, 9];
    let uuid = 30;
    const producer = new RunEventProducer({
      producerId,
      epoch: 0,
      randomUUID: () => `00000000-0000-4000-8000-${String(uuid++).padStart(12, '0')}`,
      monotonicNow: () => times.shift() ?? 0,
    });
    producer.emit({ eventClass: 'state', type: 'attempt.running', identity, payload: {} });
    expect(() => producer.emit({ eventClass: 'state', type: 'attempt.running', identity, payload: {} }))
      .toThrow(/clock moved backwards/u);
  });

  it('accepts increasing producer sequence and monotonic time', () => {
    const stream = new RunEventStreamValidator();
    expect(stream.accept(event(0)).ok).toBe(true);
    expect(stream.accept(event(1)).ok).toBe(true);
  });

  it('rejects event ids, producer sequence coordinates and clocks that collide or regress', () => {
    const duplicateId = new RunEventStreamValidator();
    const first = event(0);
    expect(duplicateId.accept(first).ok).toBe(true);
    expect(duplicateId.accept({ ...event(1), eventId: first.eventId })).toMatchObject({ ok: false, code: 'event-collision' });

    const duplicateSeq = new RunEventStreamValidator();
    expect(duplicateSeq.accept(first).ok).toBe(true);
    expect(duplicateSeq.accept({ ...event(1), seq: 0 })).toMatchObject({ ok: false, code: 'event-collision' });

    const sequence = new RunEventStreamValidator();
    expect(sequence.accept(event(1)).ok).toBe(true);
    expect(sequence.accept(event(0))).toMatchObject({ ok: false, code: 'sequence-regression' });

    const clock = new RunEventStreamValidator();
    expect(clock.accept(event(0, { monotonicTime: 10 })).ok).toBe(true);
    expect(clock.accept(event(1, { monotonicTime: 9 }))).toMatchObject({ ok: false, code: 'monotonic-time-regression' });

    const epoch = new RunEventStreamValidator();
    expect(epoch.accept(event(0, { epoch: 2 })).ok).toBe(true);
    expect(epoch.accept(event(1, { epoch: 1 }))).toMatchObject({ ok: false, code: 'epoch-regression' });
  });

  it('detects a causal cycle even when its first edge referenced a future event', () => {
    const stream = new RunEventStreamValidator();
    const first = event(0);
    const second = event(1);
    expect(stream.accept({ ...first, causedBy: [second.eventId] }).ok).toBe(true);
    expect(stream.accept({ ...second, causedBy: [first.eventId] })).toMatchObject({ ok: false, code: 'causal-cycle' });
  });
});
