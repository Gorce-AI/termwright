import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTrace, type TraceReader } from '@termwright/trace';
import { readTraceLogs } from './trace-logs.js';
import {
  buildCrashedFixtureTrace,
  buildFixtureTrace,
  FIXTURE_TREES,
} from './test/fixtures/build-trace.js';
import { UiHub } from './hub.js';
import {
  publishTraceTimeline,
  readTraceOverview,
  traceStateAt,
  type TraceOverview,
} from './trace-source.js';

let reader: TraceReader;
let overview: TraceOverview;

beforeAll(async () => {
  reader = await openTrace(await buildFixtureTrace());
  overview = await readTraceOverview(reader);
});

afterAll(async () => {
  if (reader !== undefined) await reader.close();
});

const prefix = (state: { castPrefixB64: string }): string =>
  Buffer.from(state.castPrefixB64, 'base64').toString('utf8');

describe('readTraceOverview', () => {
  it('reports no terminal profile for a recording made before profiles existed', () => {
    expect(overview.terminalProfile).toBeNull();
  });

  it('describes the recording the timeline pane draws', () => {
    expect(overview.command).toEqual(['node', 'agent.js']);
    expect(overview.columns).toBe(80);
    expect(overview.semanticTree).toBe(true);
    expect(overview.exit).toEqual({ code: 0, signal: null });
    expect(overview.durationMs).toBeGreaterThanOrEqual(1_500);
  });

  it('lists steps and revision markers, in time order', () => {
    expect(overview.steps.map((step) => step.title)).toEqual(['approve']);
    expect(overview.markers.map((marker) => marker.kind)).toEqual(['revision', 'step', 'revision']);
    const times = overview.markers.map((marker) => marker.t);
    expect([...times].sort((left, right) => left - right)).toEqual(times);
  });
});

describe('publishTraceTimeline', () => {
  it('replays the archive as the same events a live run produces', () => {
    const hub = new UiHub();
    publishTraceTimeline(hub, overview);
    expect(hub.backlog.map((message) => message.type)).toEqual([
      'run-start',
      'session',
      'test-start',
      'step',
      'step',
      'test-end',
      'run-end',
    ]);
    const [runStart, session, testStart] = hub.backlog;
    expect(runStart?.type === 'run-start' && runStart.mode).toBe('post-mortem');
    expect(session).toMatchObject({
      type: 'session',
      sessionId: overview.sessionId,
      columns: 80,
      rows: 24,
    });
    expect(testStart?.type === 'test-start' && testStart.title).toBe('node agent.js');
    const testEnd = hub.backlog.find((message) => message.type === 'test-end');
    expect(testEnd?.type === 'test-end' && testEnd.status).toBe('passed');
    // A replay reports the recording's length, not the age of the message.
    expect(testEnd?.type === 'test-end' && testEnd.durationMs).toBe(overview.durationMs);
  });
});

describe('traceStateAt', () => {
  it('reconstructs the screen before the second output arrived', async () => {
    const state = await traceStateAt(reader, 500);
    expect(prefix(state)).toContain('Permission required');
    expect(prefix(state)).not.toContain('running: ls -la');
    expect(state.columns).toBe(80);
    expect(state.rows).toBe(24);
  });

  it('returns the newest tree at or before the requested moment', async () => {
    const early = await traceStateAt(reader, 500);
    expect(early.revision).toBe(1);
    expect(early.snapshot).toEqual(FIXTURE_TREES[0]);

    const late = await traceStateAt(reader, 1_900);
    expect(late.revision).toBe(2);
    expect(late.snapshot).toEqual(FIXTURE_TREES[1]);
  });

  it('reports the step covering the requested moment', async () => {
    const state = await traceStateAt(reader, 1_200);
    expect(state.step?.title).toBe('approve');
  });

  it('clamps a scrub past the end of the recording', async () => {
    const state = await traceStateAt(reader, 10_000_000);
    expect(state.timeMs).toBeLessThanOrEqual(overview.durationMs + 1);
    expect(prefix(state)).toContain('running: ls -la');
  });

  it('is monotonic: a later moment never shows less output', async () => {
    const early = await traceStateAt(reader, 400);
    const late = await traceStateAt(reader, 1_400);
    expect(prefix(late).startsWith(prefix(early))).toBe(true);
  });
});

describe('application logs in an archive', () => {
  it('reads back what the session logged, on the cast timeline', async () => {
    const logs = await readTraceLogs(reader);
    expect(logs.available).toBe(true);
    expect(logs.records.map((entry) => entry.message)).toEqual([
      'listening on 3000',
      'pool exhausted',
    ]);

    const [line, record] = logs.records;
    expect(line?.source).toBe('file');
    expect(line?.level).toBeNull();
    expect(line?.label).toBe('server.log');
    expect(record?.level).toBe('warn');
    expect(record?.attrs).toEqual({ size: 10 });
    // Positioned on the cast timeline, so a scrub can be compared against it.
    expect(record?.t).toBeGreaterThan(line?.t ?? 0);
    expect(record?.t).toBeLessThanOrEqual(overview.durationMs);
  });
});

describe('a crashed recording', () => {
  let crashed: TraceReader;
  let crashedOverview: TraceOverview;

  beforeAll(async () => {
    crashed = await openTrace(await buildCrashedFixtureTrace());
    crashedOverview = await readTraceOverview(crashed);
  });

  afterAll(async () => {
    if (crashed !== undefined) await crashed.close();
  });

  it('surfaces the crash section, validated', () => {
    expect(crashedOverview.crash?.cause).toBe('signal SIGSEGV');
    expect(crashedOverview.crash?.screenTail).toEqual([
      'starting',
      'panic: runtime error: index out of range',
    ]);
    expect(crashedOverview.crash?.recentInputs).toHaveLength(2);
    expect(crashedOverview.crash?.recentInputs[1]?.preview).toBeUndefined();
    expect(crashedOverview.crash?.diagnosticsTail[0]?.code).toBe('protocol-violation');
    expect(crashedOverview.crash?.lastSemanticRevision).toBe(1);
  });

  it('puts a crash marker on the cast timeline, in time order', () => {
    const crashMarker = crashedOverview.markers.find((marker) => marker.kind === 'crash');
    expect(crashMarker?.t).toBe(crashedOverview.crash?.castOffset);
    expect(crashMarker?.label).toContain('SIGSEGV');
    const times = crashedOverview.markers.map((marker) => marker.t);
    expect([...times].sort((left, right) => left - right)).toEqual(times);
  });

  it('reports the run as failed on the timeline', () => {
    const hub = new UiHub();
    publishTraceTimeline(hub, crashedOverview);
    const end = hub.backlog.find((message) => message.type === 'test-end');
    expect(end?.type === 'test-end' && end.status).toBe('failed');
  });

  it('scrubbing to the crash marker shows what the program printed as it died', async () => {
    const marker = crashedOverview.markers.find((m) => m.kind === 'crash');
    const state = await traceStateAt(crashed, marker?.t ?? 0);
    expect(prefix(state)).toContain('panic: runtime error');
    expect(state.revision).toBe(crashedOverview.crash?.lastSemanticRevision);
  });

  it('leaves a clean recording without a crash or a crash marker', () => {
    expect(overview.crash).toBeNull();
    expect(overview.markers.some((marker) => marker.kind === 'crash')).toBe(false);
  });
});

describe('the terminal profile', () => {
  /**
   * The real reader keeps private state, so overriding one field means
   * forwarding the rest to the original instance rather than copying it.
   */
  const withMeta = (extra: Record<string, unknown>): TraceReader =>
    new Proxy(reader, {
      get(target, property) {
        if (property === 'meta') return { ...target.meta, ...extra };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function'
          ? (value as (...args: never[]) => unknown).bind(target)
          : value;
      },
    });

  it('comes from meta.terminalProfile, where the writer records it', async () => {
    const overviewWithProfile = await readTraceOverview(withMeta({ terminalProfile: 'cjk-wide' }));
    expect(overviewWithProfile.terminalProfile).toBe('cjk-wide');
  });

  it('is null rather than guessed when the recording predates profiles', async () => {
    expect(
      (await readTraceOverview(withMeta({ terminalProfile: undefined }))).terminalProfile,
    ).toBeNull();
    expect((await readTraceOverview(withMeta({ terminalProfile: '' }))).terminalProfile).toBeNull();
  });
});
