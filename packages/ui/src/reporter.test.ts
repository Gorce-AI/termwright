import { afterEach, describe, expect, it } from 'vitest';
import { buildFixtureTrace } from './__fixtures__/build-trace.js';
import type { ServerMessage } from './events.js';
import { TermwrightUiReporter, type UiMessageSink } from './reporter.js';
import { startUiServer, type UiServer } from './server.js';

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
  duration?: number;
  retryCount?: number;
}): Parameters<TermwrightUiReporter['onTestCaseResult']>[0] {
  return {
    id: options.id,
    fullName: options.title,
    ...(options.file === undefined ? {} : { module: { moduleId: options.file } }),
    result: () => ({
      state: options.state,
      ...(options.error === undefined ? {} : { errors: [{ message: options.error }] }),
    }),
    diagnostic: () => ({ duration: options.duration ?? 12, retryCount: options.retryCount ?? 0 }),
    meta: () => ({ termwright: { traces: options.traces ?? [] } }),
  };
}

const servers: UiServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

describe('TermwrightUiReporter', () => {
  it('translates a run into the UI event protocol', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({ sink, stepsFromTraces: false });

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
    const reporter = new TermwrightUiReporter({ sink, stepsFromTraces: false });

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
    expect(first?.type === 'test-end' && first.flaky).toBeUndefined();
    expect(second?.type === 'test-end' && second.flaky).toBe(true);

    const end = sink.messages.at(-1);
    expect(end?.type === 'run-end' && end.summary.flaky).toBe(1);
  });

  it('puts the steps of a finished test on the timeline, from its trace', async () => {
    const sink = new Collected();
    const reporter = new TermwrightUiReporter({ sink });
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
    const reporter = new TermwrightUiReporter({ sink });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(
      testCase({ id: 't1', title: 'login', state: 'passed', traces: ['/nonexistent.twtrace'] }),
    );
    await reporter.onTestRunEnd();
    expect(sink.messages.some((message) => message.type === 'test-end')).toBe(true);
  });

  it('does nothing when no UI server is configured', async () => {
    const reporter = new TermwrightUiReporter({ url: '' });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase({ id: 't1', title: 'login', state: 'passed' }));
    await expect(reporter.onTestRunEnd()).resolves.toBeUndefined();
  });

  it('publishes into a running server over its socket', async () => {
    const server = await startUiServer();
    servers.push(server);
    const reporter = new TermwrightUiReporter({ url: server.url, stepsFromTraces: false });

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
