import { describe, expect, it, vi } from 'vitest';
import { RunEventJournal } from './run-journal.js';
import {
  RunEventProducer,
  RunEventStreamValidator,
  createRunEvent,
  createRunId,
  type RunEvent,
  type RunEventClass,
} from './run-events.js';
import {
  RUN_STATES,
  RUN_STATE_TRANSITIONS,
  TERMINAL_RUN_STATES,
  canTransitionRunState,
  isTerminalRunState,
  validateRunStateTransition,
} from './run-state.js';

const uuid = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const invocationId = createRunId('invocation', () => uuid(1));
const runId = createRunId('run', () => uuid(2));
const producerId = createRunId('producer', () => uuid(3));
const identity = Object.freeze({ invocationId, runId });

function gapProducer(): RunEventProducer {
  let id = 1_000;
  let now = 1;
  return new RunEventProducer({
    producerId: createRunId('producer', () => uuid(999)),
    epoch: 0,
    randomUUID: () => uuid(id++),
    monotonicNow: () => now++,
  });
}

function event(
  seq: number,
  eventClass: RunEventClass,
  payload: Record<string, string | number> = {},
): RunEvent {
  return createRunEvent({
    eventId: createRunId('event', () => uuid(100 + seq)),
    producerId,
    epoch: 0,
    seq,
    eventClass,
    type: `${eventClass}.fixture`,
    monotonicTime: seq,
    identity,
    payload,
  });
}

describe('RunEventJournal invariants', () => {
  it('keeps authoritative events lossless and applies backpressure before mutating ordering state', async () => {
    const journal = new RunEventJournal({
      invocationId,
      runId,
      gapProducer: gapProducer(),
      limits: {
        maxAuthoritativeEvents: 1,
        maxStateKeys: 2,
        maxDiagnosticEvents: 2,
        maxPendingBytes: 16_384,
      },
    });
    expect(journal.append(event(0, 'authoritative'))).toMatchObject({ ok: true });
    expect(journal.append(event(1, 'authoritative'))).toMatchObject({
      ok: false,
      code: 'journal-full',
    });
    const barrier = journal.barrier();
    const flushed = await journal.flushThrough(barrier, () => {});
    expect(flushed.map((item) => item.seq)).toEqual([0]);
    expect(journal.append(event(1, 'authoritative'))).toMatchObject({ ok: true });
  });

  it('coalesces explicit state keys only until a barrier seals the generation', async () => {
    const journal = new RunEventJournal({ invocationId, runId, gapProducer: gapProducer() });
    expect(journal.append(event(0, 'state'), { stateKey: 'session:one' })).toMatchObject({
      ok: true,
    });
    expect(journal.append(event(1, 'state'), { stateKey: 'session:one' })).toMatchObject({
      ok: true,
    });
    const first = journal.barrier();
    expect(journal.append(event(2, 'state'), { stateKey: 'session:one' })).toMatchObject({
      ok: true,
    });
    expect((await journal.flushThrough(first, () => {})).map((item) => item.seq)).toEqual([1]);
    const second = journal.barrier();
    expect((await journal.flushThrough(second, () => {})).map((item) => item.seq)).toEqual([2]);
  });

  it('requires a bounded state key without consuming the event sequence', () => {
    const journal = new RunEventJournal({ invocationId, runId, gapProducer: gapProducer() });
    const state = event(0, 'state');
    expect(journal.append(state)).toMatchObject({ ok: false, code: 'state-key-required' });
    expect(journal.append(state, { stateKey: 'run:status' })).toMatchObject({ ok: true });
  });

  it('bounds diagnostics and emits a replayable explicit gap before retained diagnostics', async () => {
    const journal = new RunEventJournal({
      invocationId,
      runId,
      gapProducer: gapProducer(),
      limits: {
        maxAuthoritativeEvents: 2,
        maxStateKeys: 2,
        maxDiagnosticEvents: 2,
        maxPendingBytes: 16_384,
      },
    });
    journal.append(event(0, 'diagnostic', { index: 0 }));
    journal.append(event(1, 'diagnostic', { index: 1 }));
    journal.append(event(2, 'diagnostic', { index: 2 }));
    expect(journal.pending).toBe(3);
    const batch = await journal.flushThrough(journal.barrier(), () => {});
    expect(batch.map((item) => item.type)).toEqual([
      'journal.diagnostic-gap',
      'diagnostic.fixture',
      'diagnostic.fixture',
    ]);
    expect(batch[0]?.payload).toMatchObject({
      dropped: 1,
      firstEventId: event(0, 'diagnostic').eventId,
    });
    expect(batch.slice(1).map((item) => item.seq)).toEqual([1, 2]);
    const replayValidator = new RunEventStreamValidator();
    expect(batch.map((item) => replayValidator.accept(item).ok)).toEqual([true, true, true]);
  });

  it('bounds owned bytes and releases them only after a successful flush', async () => {
    const journal = new RunEventJournal({
      invocationId,
      runId,
      gapProducer: gapProducer(),
      limits: {
        maxAuthoritativeEvents: 10,
        maxStateKeys: 10,
        maxDiagnosticEvents: 10,
        maxPendingBytes: 4_096,
      },
    });
    expect(journal.append(event(0, 'authoritative', { body: 'x'.repeat(5_000) }))).toMatchObject({
      ok: false,
      code: 'journal-full',
    });
    expect(journal.pendingBytes).toBe(0);
    expect(journal.append(event(0, 'state', { body: 'first' }), { stateKey: 'run' }).ok).toBe(true);
    const firstBytes = journal.pendingBytes;
    expect(journal.append(event(1, 'state', { body: 'replacement' }), { stateKey: 'run' }).ok).toBe(
      true,
    );
    expect(journal.pendingBytes).toBeGreaterThan(0);
    expect(journal.pendingBytes).toBeLessThan(firstBytes * 2);
    await journal.flushThrough(journal.barrier(), () => {});
    expect(journal.pendingBytes).toBe(0);
    expect(journal.peakPending).toBe(1);
    expect(journal.peakPendingBytes).toBeGreaterThan(0);
  });

  it('keeps the exact sealed batch when the sink fails, then invalidates a successful barrier', async () => {
    const journal = new RunEventJournal({ invocationId, runId, gapProducer: gapProducer() });
    journal.append(event(0, 'authoritative'));
    const barrier = journal.barrier();
    const failing = vi.fn(() => Promise.reject(new Error('disk unavailable')));
    await expect(journal.flushThrough(barrier, failing)).rejects.toThrow('disk unavailable');
    expect(journal.pending).toBe(1);
    const written: RunEvent[][] = [];
    const retry = await journal.flushThrough(barrier, (batch) => {
      written.push([...batch]);
    });
    expect(retry.map((item) => item.eventId)).toEqual([event(0, 'authoritative').eventId]);
    expect(written).toHaveLength(1);
    expect(journal.pending).toBe(0);
    await expect(journal.flushThrough(barrier, () => {})).rejects.toThrow(/barrier/u);
  });

  it('rejects concurrent flushes so barriers cannot overtake each other', async () => {
    const journal = new RunEventJournal({ invocationId, runId, gapProducer: gapProducer() });
    journal.append(event(0, 'authoritative'));
    const first = journal.barrier();
    let release!: () => void;
    const blocked = journal.flushThrough(
      first,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await expect(journal.flushThrough(first, () => {})).rejects.toThrow(/already in progress/u);
    release();
    await expect(blocked).resolves.toHaveLength(1);
  });

  it('rejects stale runs, sequence collisions and epoch regression deterministically', () => {
    const journal = new RunEventJournal({ invocationId, runId, gapProducer: gapProducer() });
    const otherRun = createRunId('run', () => uuid(55));
    expect(
      journal.append({ ...event(0, 'authoritative'), identity: { invocationId, runId: otherRun } }),
    ).toMatchObject({ ok: false, code: 'stale-run' });
    expect(journal.append(event(0, 'authoritative'))).toMatchObject({ ok: true });
    expect(journal.append({ ...event(1, 'authoritative'), seq: 0 })).toMatchObject({
      ok: false,
      code: 'sequence-regression',
    });
    const newEpoch = { ...event(2, 'authoritative'), epoch: 2 };
    expect(journal.append(newEpoch)).toMatchObject({ ok: true });
    expect(journal.append({ ...event(3, 'authoritative'), epoch: 1 })).toMatchObject({
      ok: false,
      code: 'epoch-regression',
    });
  });
});

describe('closed run lifecycle', () => {
  it('defines every terminal status as a sink', () => {
    expect(new Set(RUN_STATES).size).toBe(RUN_STATES.length);
    for (const state of TERMINAL_RUN_STATES) {
      expect(isTerminalRunState(state)).toBe(true);
      expect(RUN_STATE_TRANSITIONS[state]).toEqual([]);
    }
  });

  it('accepts the normal and cancellation paths and rejects terminal resurrection', () => {
    const path: (typeof RUN_STATES)[number][] = [
      'requested',
      'collecting',
      'scheduled',
      'running',
      'finalizing',
      'passed',
    ];
    expect(
      path.every((state, index) => index === 0 || canTransitionRunState(path[index - 1]!, state)),
    ).toBe(true);
    expect(validateRunStateTransition('running', 'cancelling')).toMatchObject({ ok: true });
    expect(validateRunStateTransition('cancelling', 'cancelled')).toMatchObject({ ok: true });
    expect(validateRunStateTransition('failed', 'running')).toMatchObject({
      ok: false,
      code: 'illegal-run-transition',
    });
    expect(validateRunStateTransition('running', 'mystery')).toMatchObject({
      ok: false,
      code: 'invalid-run-state',
    });
  });
});
