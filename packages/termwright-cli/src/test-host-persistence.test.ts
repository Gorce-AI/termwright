import { describe, expect, it } from 'vitest';
import { RunEventProducer, RunIdFactory } from '@termwright/protocol';
import {
  HostRunBudget,
  RunEventPersistence,
  captureCiProvenance,
  createRunManifest,
  type TermwrightHostDeadlineRuntime,
} from './test-host-persistence.js';

describe('test-host persistence seams', () => {
  it('keeps canonical events when a best-effort observer throws and flushes them once', async () => {
    const ids = new RunIdFactory();
    const invocationId = ids.create('invocation');
    const runId = ids.create('run');
    const producer = new RunEventProducer({ producerId: ids.create('producer'), epoch: 0 });
    const flushed: unknown[] = [];
    const persistence = new RunEventPersistence({
      invocationId,
      runId,
      gapProducer: new RunEventProducer({ producerId: ids.create('producer'), epoch: 0 }),
      sink: (events) => {
        flushed.push(...events);
      },
      observer: () => {
        throw new Error('broken projection');
      },
    });
    const event = producer.emit({
      eventClass: 'authoritative',
      type: 'run.configuration',
      identity: { invocationId, runId },
      payload: { source: 'unit seam' },
    });
    expect(persistence.append(event).ok).toBe(true);
    await persistence.flush();
    expect(persistence.recorded).toEqual([event]);
    expect(flushed).toEqual([event]);
    expect(persistence.metrics()).toMatchObject({
      acceptedEvents: 1,
      sinkCalls: 1,
      peakBacklogEvents: 1,
    });
    expect(persistence.metrics().acceptedBytes).toBeGreaterThan(0);
    expect(persistence.metrics().peakBacklogBytes).toBeGreaterThan(0);
  });

  it('retains an exact failed sink batch and preserves later event ordering on retry', async () => {
    const ids = new RunIdFactory();
    const invocationId = ids.create('invocation');
    const runId = ids.create('run');
    const producer = new RunEventProducer({ producerId: ids.create('producer'), epoch: 0 });
    const written: unknown[] = [];
    let fail = true;
    const persistence = new RunEventPersistence({
      invocationId,
      runId,
      gapProducer: new RunEventProducer({ producerId: ids.create('producer'), epoch: 0 }),
      sink: (events) => {
        if (fail) {
          fail = false;
          throw new Error('projection unavailable');
        }
        written.push(...events);
      },
    });
    const first = producer.emit({
      eventClass: 'authoritative',
      type: 'run.configuration',
      identity: { invocationId, runId },
      payload: { source: 'first' },
    });
    const second = producer.emit({
      eventClass: 'authoritative',
      type: 'run.configuration',
      identity: { invocationId, runId },
      payload: { source: 'second' },
    });
    expect(persistence.append(first).ok).toBe(true);
    await expect(persistence.flush()).rejects.toThrow('projection unavailable');
    expect(persistence.append(second).ok).toBe(true);
    await persistence.flush();
    expect(written).toEqual([first, second]);
    expect(persistence.recorded).toEqual([first, second]);
  });

  it('keeps only a bounded live projection while streaming every canonical event', async () => {
    const ids = new RunIdFactory();
    const invocationId = ids.create('invocation');
    const runId = ids.create('run');
    const producer = new RunEventProducer({ producerId: ids.create('producer'), epoch: 0 });
    let streamed = 0;
    const persistence = new RunEventPersistence({
      invocationId,
      runId,
      gapProducer: new RunEventProducer({ producerId: ids.create('producer'), epoch: 0 }),
      sink: (events) => {
        streamed += events.length;
      },
    });
    const total = RunEventPersistence.MAX_PROJECTED_EVENTS + 128;
    for (let index = 0; index < total; index += 1) {
      const event = producer.emit({
        eventClass: 'authoritative',
        type: 'run.configuration',
        identity: { invocationId, runId },
        payload: { index },
      });
      expect(persistence.append(event).ok).toBe(true);
      if (index % 64 === 63) await persistence.flush();
    }
    await persistence.flush();
    expect(streamed).toBe(total);
    expect(persistence.metrics().acceptedEvents).toBe(total);
    expect(persistence.recorded).toHaveLength(RunEventPersistence.MAX_PROJECTED_EVENTS);
    expect(persistence.recorded[0]?.payload).toEqual({ index: 128 });
  });

  it('builds a frozen manifest without a host or filesystem transaction', () => {
    const ids = new RunIdFactory();
    const start = {
      invocationId: ids.create('invocation'),
      runId: ids.create('run'),
      startedAt: 10,
      engine: { name: 'vitest' as const, version: '4.1.11', certification: 'unit' },
      runtime: { node: 'v22', platform: 'test', arch: 'test' },
      resources: {
        profile: 'unit',
        scheduler: { pool: 'forks', maxWorkers: 1, fileParallelism: false },
        capacities: {},
        perAttempt: {},
        perTerminal: {},
      },
      timeouts: { totalRunMs: 100, finalizationReserveMs: 10 },
      ci: {},
      git: null,
    };
    const manifest = createRunManifest(start, {
      status: 'passed',
      specs: [],
      attempts: [],
      telemetry: fixtureTelemetry(),
      durationMs: 7,
      finishedAt: 20,
    });
    expect(manifest).toMatchObject({
      v: 7,
      startedAt: 10,
      finishedAt: 20,
      durationMs: 7,
      status: 'passed',
    });
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('whitelists and bounds CI provenance', () => {
    expect(
      captureCiProvenance({
        GITHUB_RUN_ID: '123',
        SECRET_TOKEN: 'no',
        BUILD_ID: 'x'.repeat(20_000),
      }),
    ).toEqual({ GITHUB_RUN_ID: '123', BUILD_ID: 'x'.repeat(16_384) });
  });

  it('reserves finalization time without starting a host', async () => {
    let now = 0;
    const timers: Array<{ readonly at: number; readonly elapsed: () => void }> = [];
    const runtime: TermwrightHostDeadlineRuntime = {
      now: () => now,
      schedule: (delay, elapsed) => {
        const timer = { at: now + delay, elapsed };
        timers.push(timer);
        return () => {
          const index = timers.indexOf(timer);
          if (index >= 0) timers.splice(index, 1);
        };
      },
    };
    const budget = new HostRunBudget(100, 25, runtime);
    expect(budget.elapsedMs()).toBe(0);
    expect(budget.executionRemainingMs()).toBe(75);
    expect(budget.finalizationRemainingMs()).toBe(100);
    const execution = budget.execution('unit execution', () => new Promise<never>(() => undefined));
    now = 75;
    expect(budget.elapsedMs()).toBe(75);
    expect(budget.executionRemainingMs()).toBe(0);
    expect(budget.finalizationRemainingMs()).toBe(25);
    for (const timer of [...timers]) if (timer.at <= now) timer.elapsed();
    await expect(execution).rejects.toMatchObject({
      code: 'TW_HOST_TIMEOUT',
      phase: 'unit execution',
    });
  });

  it('keeps the production finalization reserve available after execution expires', async () => {
    let now = 0;
    const timers: Array<{ readonly at: number; readonly elapsed: () => void }> = [];
    const runtime: TermwrightHostDeadlineRuntime = {
      now: () => now,
      schedule: (delay, elapsed) => {
        const timer = { at: now + delay, elapsed };
        timers.push(timer);
        return () => {
          const index = timers.indexOf(timer);
          if (index >= 0) timers.splice(index, 1);
        };
      },
    };
    const budget = new HostRunBudget(10 * 60_000, 30_000, runtime);
    const execution = budget.execution('native tests', () => new Promise<never>(() => undefined));

    now = 9 * 60_000 + 30_000;
    for (const timer of [...timers]) if (timer.at <= now) timer.elapsed();
    await expect(execution).rejects.toMatchObject({
      code: 'TW_HOST_TIMEOUT',
      phase: 'native tests',
    });

    const finalized = await budget.finalization('canonical run history', async () => 'committed');
    expect(finalized).toBe('committed');
    expect(timers).toEqual([]);
  });

  it('fails closed if an injected monotonic clock regresses', () => {
    let now = 10;
    const runtime: TermwrightHostDeadlineRuntime = {
      now: () => now,
      schedule: () => () => undefined,
    };
    const budget = new HostRunBudget(100, 25, runtime);
    now = 9;
    expect(() => budget.elapsedMs()).toThrow(/monotonic clock regressed/u);
  });
});

function fixtureTelemetry() {
  return {
    coordinatorCpuUserMicros: 1,
    coordinatorCpuSystemMicros: 1,
    coordinatorRssStartBytes: 1,
    coordinatorRssEndBytes: 1,
    coordinatorPeakSampledRssBytes: 1,
    workerPeakRssBytes: 'unavailable' as const,
    workerCpuUserMicros: 'unavailable' as const,
    workerCpuSystemMicros: 'unavailable' as const,
    ownedProcessPeakRssBytes: 'unavailable' as const,
    ownedProcessCountPeak: 'unavailable' as const,
    ptySlotsPeak: 0,
    terminalOutputBytes: 0,
    semanticBytes: 0,
    semanticFullCount: 0,
    semanticDeltaCount: 0,
    journalAcceptedEvents: 0,
    journalAcceptedBytes: 0,
    journalSinkCalls: 0,
    journalPeakBacklogEvents: 0,
    journalPeakBacklogBytes: 0,
    traceBytes: 0,
    tempDiskPeakBytes: 'unavailable' as const,
    finalArtifactBytes: 0,
  };
}
