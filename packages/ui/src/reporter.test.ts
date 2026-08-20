import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRunHistory, readRunManifest } from './runs.js';
import { buildFixtureTrace } from './__fixtures__/build-trace.js';
import type { ServerMessage } from './events.js';
import { TermwrightUiReporter, UI_SELECTION_ENV, type UiMessageSink } from './reporter.js';
import { startUiServer, type UiServer } from './server.js';
import { termwrightProvider } from './provider.js';

class Collected implements UiMessageSink {
  readonly messages: ServerMessage[] = [];
  publish(message: ServerMessage): void {
    this.messages.push(message);
  }
}

/** The subset of Vitest's reported `TestCase` the reporter reads. */
function testCase(options: {
  id: string;
  title: string;
  state: string;
  file?: string;
  traces?: readonly string[];
  error?: string;
  errors?: readonly string[];
  duration?: number;
  retryCount?: number;
  lostLogRecords?: number;
  attemptFailures?: readonly { readonly attempt: number; readonly errors: readonly { readonly message: string }[] }[];
}): Parameters<TermwrightUiReporter['onTestCaseResult']>[0] {
  return {
    id: options.id,
    fullName: options.title,
    ...(options.file === undefined ? {} : { module: { moduleId: options.file } }),
    result: () => ({
      state: options.state,
      ...(options.errors !== undefined
        ? { errors: options.errors.map((message) => ({ message })) }
        : options.error === undefined ? {} : { errors: [{ message: options.error }] }),
    }),
    diagnostic: () => ({ duration: options.duration ?? 12, retryCount: options.retryCount ?? 0 }),
    meta: () => ({
      termwright: {
        provider: termwrightProvider('@termwright/test'),
        traces: options.traces ?? [],
        // `@termwright/test` omits the field entirely when nothing was lost.
        ...(options.lostLogRecords === undefined ? {} : { lostLogRecords: options.lostLogRecords }),
        ...(options.attemptFailures === undefined ? {} : { attemptFailures: options.attemptFailures }),
      },
    }),
  };
}

const servers: UiServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) await server.close();
});

describe('TermwrightUiReporter', () => {
  it('publishes and retains an actionless Gherkin step without inventing a terminal session', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({ sink, stepsFromTraces: false, runsDir: null });
    const scenario = testCase({ id: 'scenario-1', title: 'Feature > Scenario', state: 'run', file: '/repo/demo.feature' });
    reporter.onTestRunStart();
    reporter.onTestCaseReady(scenario);
    reporter.onTestCaseAnnotate(scenario, {
      type: 'termwright:step',
      attachment: { body: JSON.stringify({
        title: 'When I press Tab', phase: 'start', stepId: 'tw-step-2',
        gherkin: { keyword: 'When', text: 'I press Tab', source: { file: '/repo/demo.feature', line: 5, column: 5 } },
      }) },
    });
    expect(sink.messages.at(-1)).toMatchObject({
      type: 'step', testId: 'scenario-1', stepId: 'tw-step-2', phase: 'start',
      gherkin: { keyword: 'When', text: 'I press Tab', source: { line: 5, column: 5 } },
    });
    reporter.onTestCaseAnnotate(scenario, {
      type: 'termwright:step',
      attachment: { body: JSON.stringify({
        title: 'When I press Tab', phase: 'end', status: 'passed', stepId: 'tw-step-2',
        gherkin: { keyword: 'When', text: 'I press Tab', source: { file: '/repo/demo.feature', line: 5, column: 5 } },
      }) },
    });
    reporter.onTestCaseResult(testCase({ id: 'scenario-1', title: 'Feature > Scenario', state: 'passed', file: '/repo/demo.feature' }));
    await reporter.onTestRunEnd();
    expect(sink.messages.filter((message) => message.type === 'step')).toHaveLength(2);
    expect(sink.messages.some((message) => message.type === 'session')).toBe(false);
    expect(sink.messages.find((message) => message.type === 'test-end')).toMatchObject({ type: 'test-end', status: 'passed' });
  });

  it('does not publish a foreign Vitest case even without a browser selection', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({ sink, stepsFromTraces: false, runsDir: null });
    const foreign = {
      id: 'foreign',
      fullName: 'an unrelated unit test',
      module: { moduleId: '/repo/unit.test.ts' },
      result: () => ({ state: 'passed' }),
      meta: () => ({}),
    };

    reporter.onTestRunStart();
    reporter.onTestCaseReady(foreign);
    reporter.onTestCaseResult(foreign);
    reporter.onTestCaseAnnotate(foreign, {
      type: 'termwright:action',
      attachment: { body: JSON.stringify({ api: 'press', t: 1 }) },
    });
    await reporter.onTestRunEnd();

    expect(sink.messages.map((message) => message.type)).toEqual(['run-start', 'run-end']);
    const end = sink.messages.at(-1);
    expect(end?.type === 'run-end' && end.summary.total).toBe(0);
  });

  it('translates a run into the UI event protocol', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({ sink, stepsFromTraces: false, runsDir: null });

    reporter.onTestRunStart();
    reporter.onTestCaseReady(testCase({ id: 't1', title: 'login', state: 'run', file: '/repo/a.test.ts' }));
    reporter.onTestCaseResult(testCase({ id: 't1', title: 'login', state: 'passed' }));
    reporter.onTestCaseResult(
      testCase({ id: 't2', title: 'logout', state: 'failed', error: 'button stayed disabled' }),
    );
    await reporter.onTestRunEnd();

    expect(sink.messages.map((message) => message.type)).toEqual([
      'run-start',
      'test-start',
      'test-end',
      'test-end',
      'run-end',
    ]);
    const failure = sink.messages[3];
    expect(failure?.type === 'test-end' && failure.error).toBe('button stayed disabled');
    const end = sink.messages.at(-1);
    expect(end?.type === 'run-end' && end.summary).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
    });
  });

  it('reports how long each test took, and which ones were flaky', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({ sink, stepsFromTraces: false, runsDir: null });

    reporter.onTestRunStart();
    reporter.onTestCaseReady(testCase({ id: 't1', title: 'login', state: 'run' }));
    reporter.onTestCaseResult(testCase({ id: 't1', title: 'login', state: 'passed', duration: 340 }));
    reporter.onTestCaseResult(
      testCase({ id: 't2', title: 'retried', state: 'passed', duration: 90, retryCount: 2 }),
    );
    await reporter.onTestRunEnd();

    const start = sink.messages.find((message) => message.type === 'test-start');
    expect(start?.type === 'test-start' && typeof start.startedAt).toBe('number');

    const [first, second] = sink.messages.filter((message) => message.type === 'test-end');
    expect(first?.type === 'test-end' && first.durationMs).toBe(340);
    expect(first?.type === 'test-end' && first.flaky).toBe(false);
    expect(second?.type === 'test-end' && second.flaky).toBe(true);

    const end = sink.messages.at(-1);
    expect(end?.type === 'run-end' && end.summary.flaky).toBe(1);
  });

  it('reports the final attempt number and ordered prior failure reasons', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({ sink, stepsFromTraces: false, runsDir: null });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase({
      id: 'retry',
      title: 'eventually passes',
      state: 'passed',
      retryCount: 2,
      errors: ['first failure', 'second failure'],
      attemptFailures: [
        { attempt: 1, errors: [{ message: 'first failure' }] },
        { attempt: 2, errors: [{ message: 'second failure' }] },
      ],
    }));
    await reporter.onTestRunEnd();

    expect(sink.messages.find((message) => message.type === 'test-end')).toMatchObject({
      type: 'test-end',
      status: 'passed',
      attempt: 3,
      priorFailures: [
        { attempt: 1, errors: ['first failure'] },
        { attempt: 2, errors: ['second failure'] },
      ],
    });
  });

  it('does not turn siblings excluded by a UI selection into skipped results', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({
      sink,
      stepsFromTraces: false,
      runsDir: null,
      selection: ['/repo/a.test.ts::suite > selected'],
    });

    reporter.onTestRunStart();
    reporter.onTestCaseReady(
      testCase({ id: 'selected-runtime', title: 'suite > selected', state: 'run', file: '/repo/a.test.ts' }),
    );
    reporter.onTestCaseReady(
      testCase({ id: 'filtered-runtime', title: 'suite > filtered', state: 'run', file: '/repo/a.test.ts' }),
    );
    reporter.onTestCaseResult(
      testCase({ id: 'selected-runtime', title: 'suite > selected', state: 'passed', file: '/repo/a.test.ts' }),
    );
    reporter.onTestCaseResult(
      testCase({ id: 'filtered-runtime', title: 'suite > filtered', state: 'skipped', file: '/repo/a.test.ts' }),
    );
    await reporter.onTestRunEnd();

    expect(sink.messages.filter((message) => message.type === 'test-end')).toHaveLength(1);
    expect(sink.messages.filter((message) => message.type === 'test-start')).toHaveLength(1);
    const end = sink.messages.at(-1);
    expect(end?.type === 'run-end' && end.summary).toMatchObject({ total: 1, passed: 1, skipped: 0 });
  });

  it('keeps a genuinely skipped case when that case was selected', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({
      sink,
      stepsFromTraces: false,
      runsDir: null,
      selection: ['/repo/a.test.ts::suite > selected skip'],
    });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(
      testCase({ id: 'skip-runtime', title: 'suite > selected skip', state: 'skipped', file: '/repo/a.test.ts' }),
    );
    await reporter.onTestRunEnd();

    expect(sink.messages.filter((message) => message.type === 'test-end')).toHaveLength(1);
    const end = sink.messages.at(-1);
    expect(end?.type === 'run-end' && end.summary.skipped).toBe(1);
  });

  it('does not publish siblings excluded by the initial watcher name pattern', async () => {
    const sink = new Collected();
    vi.stubEnv(UI_SELECTION_ENV, JSON.stringify({ testNamePattern: '^suite selected$' }));
    const reporter = new TermwrightUiReporter({
      sink,
      stepsFromTraces: false,
      runsDir: null,
    });

    reporter.onTestRunStart();
    reporter.onTestCaseReady(
      testCase({ id: 'selected-runtime', title: 'suite > selected', state: 'run', file: '/repo/a.test.ts' }),
    );
    reporter.onTestCaseReady(
      testCase({ id: 'filtered-runtime', title: 'suite > sibling', state: 'run', file: '/repo/a.test.ts' }),
    );
    reporter.onTestCaseResult(
      testCase({ id: 'selected-runtime', title: 'suite > selected', state: 'passed', file: '/repo/a.test.ts' }),
    );
    reporter.onTestCaseResult(
      testCase({ id: 'filtered-runtime', title: 'suite > sibling', state: 'skipped', file: '/repo/a.test.ts' }),
    );
    await reporter.onTestRunEnd();

    const starts = sink.messages.filter((message) => message.type === 'test-start');
    const ends = sink.messages.filter((message) => message.type === 'test-end');
    expect(starts).toHaveLength(1);
    expect(starts[0]?.type === 'test-start' && starts[0].id).toBe('selected-runtime');
    expect(ends).toHaveLength(1);
    const end = sink.messages.at(-1);
    expect(end?.type === 'run-end' && end.summary).toMatchObject({ total: 1, passed: 1, skipped: 0 });
  });

  it('passes on the count of log records the harness lost, and zero when it lost none', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({ sink, runsDir: null, stepsFromTraces: false });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase({ id: 't1', title: 'lossy', state: 'passed', lostLogRecords: 9 }));
    reporter.onTestCaseResult(testCase({ id: 't2', title: 'clean', state: 'passed' }));
    await reporter.onTestRunEnd();

    const [lossy, clean] = sink.messages.filter((message) => message.type === 'test-end');
    expect(lossy?.type === 'test-end' && lossy.lostLogRecords).toBe(9);
    // The producer omits the field for zero; the message still carries it,
    // because "nobody counted" is not something a viewer should have to guess.
    expect(clean?.type === 'test-end' && clean.lostLogRecords).toBe(0);
  });

  it('puts the steps of a finished test on the timeline, from its trace', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({ sink, runsDir: null });
    const tracePath = await buildFixtureTrace();

    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase({ id: 't1', title: 'login', state: 'passed', traces: [tracePath] }));
    await reporter.onTestRunEnd();
    await new Promise((done) => setTimeout(done, 100));

    const steps = sink.messages.filter((message) => message.type === 'step');
    expect(steps).toHaveLength(2);
    expect(steps[0]?.type === 'step' && steps[0].title).toBe('approve');
    expect(steps[1]?.type === 'step' && steps[1].phase).toBe('end');
    const end = sink.messages.find((message) => message.type === 'test-end');
    expect(end?.type === 'test-end' && end.traceRef).toBe(tracePath);
  });

  it('ignores an unreadable trace rather than failing the run', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({ sink, runsDir: null });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(
      testCase({ id: 't1', title: 'login', state: 'passed', traces: ['/nonexistent.twtrace'] }),
    );
    await reporter.onTestRunEnd();
    expect(sink.messages.some((message) => message.type === 'test-end')).toBe(true);
  });

  it('does nothing when no UI server is configured', async () => {
    const reporter = new TermwrightUiReporter({ url: '', runsDir: null });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase({ id: 't1', title: 'login', state: 'passed' }));
    await expect(reporter.onTestRunEnd()).resolves.toBeUndefined();
  });

  it('publishes into a running server over its socket', async () => {
    const server = await startUiServer();
    servers.push(server);
    const reporter = new TermwrightUiReporter({ url: server.url, stepsFromTraces: false, runsDir: null });

    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase({ id: 't1', title: 'login', state: 'passed' }));
    await reporter.onTestRunEnd();

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !server.hub.backlog.some((message) => message.type === 'run-end')) {
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(server.hub.backlog.map((message) => message.type)).toEqual([
      'run-start',
      'test-end',
      'run-end',
    ]);
  });
});

describe('run history', () => {
  it('writes a manifest of the run it just reported', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'tw-reporter-runs-'));
    const reporter = new TermwrightUiReporter({ sink: new Collected(), stepsFromTraces: false, runsDir });

    reporter.onTestRunStart();
    reporter.onTestCaseResult(
      testCase({
        id: 't1', title: 'login', state: 'passed', file: '/repo/a.test.ts', duration: 42,
        retryCount: 1,
        errors: ['aggregated old failure'],
        attemptFailures: [{ attempt: 1, errors: [{ message: 'nope' }] }],
      }),
    );
    await reporter.onTestRunEnd();

    const [run] = await readRunHistory(runsDir);
    expect(run?.summary.flaky).toBe(1);
    const manifest = await readRunManifest(runsDir, run?.id ?? '');
    expect(manifest?.tests[0]).toMatchObject({
      title: 'login',
      file: '/repo/a.test.ts',
      status: 'passed',
      durationMs: 42,
      attempts: [
        { attempt: 1, status: 'failed', errors: ['nope'] },
        { attempt: 2, status: 'passed', durationMs: 42, errors: [] },
      ],
    });
    expect(manifest?.tests[0]).not.toHaveProperty('error');
  });

  it('does not write one when history is turned off', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'tw-reporter-runs-'));
    const reporter = new TermwrightUiReporter({ sink: new Collected(), runsDir: null });
    reporter.onTestRunStart();
    await reporter.onTestRunEnd();
    expect(await readRunHistory(runsDir)).toEqual([]);
  });
});
