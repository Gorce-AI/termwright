import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Reporter } from 'vitest/node';
import { TermwrightReporter, toReportResults } from './reporter.js';
import type { ReportCrash } from './crash.js';

const directories: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tw-reporter-'));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() as string, { recursive: true, force: true });
});

interface CaseOptions {
  readonly project?: string;
  readonly state?: string;
  readonly retryCount?: number;
  readonly flaky?: boolean;
  readonly traces?: readonly string[];
  readonly obsolete?: readonly string[];
  readonly crashes?: readonly ReportCrash[];
  readonly error?: string;
  readonly errors?: readonly string[];
  readonly attemptFailures?: readonly {
    readonly attempt: number;
    readonly errors: readonly { readonly message: string; readonly stack?: string }[];
    readonly traceRefs?: readonly string[];
  }[];
}

function testCase(id: string, fullName: string, options: CaseOptions = {}): Parameters<TermwrightReporter['onTestCaseResult']>[0] {
  return {
    id,
    fullName,
    module: { moduleId: '/repo/src/login.test.ts' },
    ...(options.project === undefined ? {} : { project: { name: options.project } }),
    result: () => ({
      state: options.state ?? 'passed',
      ...(options.errors !== undefined
        ? { errors: options.errors.map((message) => ({ message })) }
        : options.error === undefined ? {} : { errors: [{ message: options.error, stack: 'at x' }] }),
    }),
    diagnostic: () => ({
      duration: 12,
      retryCount: options.retryCount ?? 0,
      ...(options.flaky === undefined ? {} : { flaky: options.flaky }),
    }),
    meta: () =>
      options.traces === undefined && options.obsolete === undefined && options.crashes === undefined && options.attemptFailures === undefined
        ? {}
        : {
            termwright: {
              ...(options.traces === undefined ? {} : { traces: options.traces }),
              ...(options.obsolete === undefined ? {} : { obsoleteSnapshots: options.obsolete }),
              ...(options.crashes === undefined ? {} : { crashes: options.crashes }),
              ...(options.attemptFailures === undefined ? {} : { attemptFailures: options.attemptFailures }),
            },
          },
  };
}

describe('TermwrightReporter', () => {
  it('labels matrix results with their Vitest project', () => {
    const reporter = new TermwrightReporter({ silent: true });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase('matrix-1', 'layout > works', { project: 'compact' }));
    expect(reporter.tests[0]?.title).toBe('[compact] layout > works');
  });
  it('is assignable to the Reporter interface Vitest expects', () => {
    // Compile-time assertion. This package builds with
    // `exactOptionalPropertyTypes`, and so do its users: the structural views
    // of Vitest's `TestCase` below must accept `T | undefined` wherever Vitest
    // declares an optional property, or `reporters: [new TermwrightReporter()]`
    // stops typechecking in the consumer's `vitest.config.ts`.
    const reporter: Reporter = new TermwrightReporter({ silent: true });
    expect(reporter).toBeInstanceOf(TermwrightReporter);
  });

  it('collects outcomes, traces and durations', () => {
    const reporter = new TermwrightReporter({ silent: true });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase('1', 'login > works', { traces: ['out/a.twtrace'] }));
    reporter.onTestCaseResult(testCase('2', 'login > fails', { state: 'failed', error: 'boom' }));
    expect(reporter.tests).toEqual([
      {
        id: '1',
        title: 'login > works',
        status: 'passed',
        flaky: false,
        file: '/repo/src/login.test.ts',
        durationMs: 12,
        tracePath: 'out/a.twtrace',
      },
      {
        id: '2',
        title: 'login > fails',
        status: 'failed',
        flaky: false,
        file: '/repo/src/login.test.ts',
        durationMs: 12,
        error: { message: 'boom', stack: 'at x' },
      },
    ]);
  });

  it('classifies a test that only passed after a retry as flaky', () => {
    const reporter = new TermwrightReporter({ silent: true });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase('1', 'retried', { retryCount: 2 }));
    reporter.onTestCaseResult(testCase('2', 'declared flaky', { flaky: true }));
    reporter.onTestCaseResult(testCase('3', 'steady'));
    expect(reporter.tests.filter((test) => test.flaky).map((test) => test.title)).toEqual([
      'retried',
      'declared flaky',
    ]);
  });

  it('keeps ordered native attempt failures and reports the final attempt', async () => {
    const dir = workspace();
    const reporter = new TermwrightReporter({ silent: true, outFile: join(dir, 'retry.html') });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase('1', 'eventually works', {
      retryCount: 2,
      // Vitest aggregates prior errors on the final result. They belong to
      // their captured attempt, not to the passing final attempt.
      errors: ['aggregated first', 'aggregated second'],
      attemptFailures: [
        { attempt: 1, errors: [{ message: 'socket not ready', stack: 'first stack' }], traceRefs: ['retry-1.twtrace'] },
        { attempt: 2, errors: [{ message: 'prompt missing' }] },
      ],
    }));

    expect(reporter.tests[0]?.attempts).toEqual([
      { attempt: 1, status: 'failed', errors: [{ message: 'socket not ready', stack: 'first stack' }], tracePaths: ['retry-1.twtrace'] },
      { attempt: 2, status: 'failed', errors: [{ message: 'prompt missing' }] },
      { attempt: 3, status: 'passed', durationMs: 12, errors: [] },
    ]);
    expect(reporter.tests[0]).not.toHaveProperty('error');
    await reporter.report();
    const html = readFileSync(join(dir, 'retry.html'), 'utf8');
    expect(html).toContain('Attempts · 3');
    expect(html).toContain('Attempt 1');
    expect(html).toContain('socket not ready');
    expect(html).toContain('Attempt 3');
  });

  it('writes a report for failures and flakes, and nothing when all is well', async () => {
    const dir = workspace();
    const passing = new TermwrightReporter({ silent: true, outFile: join(dir, 'none.html') });
    passing.onTestRunStart();
    passing.onTestCaseResult(testCase('1', 'fine'));
    expect(await passing.report()).toBeUndefined();
    expect(existsSync(join(dir, 'none.html'))).toBe(false);

    const failing = new TermwrightReporter({ silent: true, outFile: join(dir, 'report.html'), title: 'run' });
    failing.onTestRunStart();
    failing.onTestCaseResult(testCase('1', 'login > fails', { state: 'failed', error: 'boom' }));
    failing.onTestCaseResult(testCase('2', 'login > flaky', { retryCount: 1 }));
    failing.onTestCaseResult(testCase('3', 'login > fine'));
    const outFile = await failing.report();
    expect(outFile).toBe(join(dir, 'report.html'));
    const html = readFileSync(join(dir, 'report.html'), 'utf8');
    expect(html).toContain('login &gt; fails');
    expect(html).toContain('login &gt; flaky');
    expect(html).not.toContain('login &gt; fine');
  });

  it('includes a passing test that kept its trace, as `trace: \'on\'` makes it', async () => {
    const dir = workspace();
    const reporter = new TermwrightReporter({ silent: true, outFile: join(dir, 'on.html') });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase('1', 'login > works', { traces: ['out/works.twtrace'] }));
    reporter.onTestCaseResult(testCase('2', 'login > also works'));
    expect(await reporter.report()).toBe(join(dir, 'on.html'));
    const html = readFileSync(join(dir, 'on.html'), 'utf8');
    expect(html).toContain('login &gt; works');
    // The one without artefacts stays out: there is nothing to show for it.
    expect(html).not.toContain('login &gt; also works');
  });

  it('includes passing tests when asked', async () => {
    const dir = workspace();
    const reporter = new TermwrightReporter({ silent: true, includePassed: true, outFile: join(dir, 'all.html') });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase('1', 'login > fine'));
    await reporter.report();
    expect(readFileSync(join(dir, 'all.html'), 'utf8')).toContain('login &gt; fine');
  });

  it('falls back to the legacy task tree when no test case arrived', async () => {
    const dir = workspace();
    const reporter = new TermwrightReporter({ silent: true, outFile: join(dir, 'legacy.html') });
    reporter.onTestRunStart();
    await reporter.onFinished([
      {
        type: 'suite',
        name: '/repo/src/login.test.ts',
        filepath: '/repo/src/login.test.ts',
        tasks: [
          {
            type: 'suite',
            name: 'login',
            tasks: [
              {
                type: 'test',
                id: '9',
                name: 'fails',
                file: { filepath: '/repo/src/login.test.ts' },
                result: { state: 'fail', duration: 3, errors: [{ message: 'nope' }] },
                meta: { termwright: { traces: ['out/x.twtrace'] } },
              },
            ],
          },
        ],
      },
    ] as never);
    expect(reporter.tests[0]).toMatchObject({ title: 'login > fails', status: 'failed', tracePath: 'out/x.twtrace' });
    expect(existsSync(join(dir, 'legacy.html'))).toBe(true);
  });

  it('names obsolete snapshots in the summary of an otherwise green run', async () => {
    const written: string[] = [];
    const stdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    const reporter = new TermwrightReporter({ outFile: join(workspace(), 'none.html') });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase('1', 'passes', { obsolete: ['login > renamed away 1'] }));
    try {
      // Green run: no report is written, and the run must not go red.
      expect(await reporter.report()).toBeUndefined();
    } finally {
      process.stdout.write = stdout;
    }

    const summary = written.join('');
    expect(summary).toContain('1 obsolete snapshot (no test claims it any more)');
    expect(summary).toContain('login > renamed away 1');
    expect(summary).toContain('vitest -u');
  });

  it('carries a crash from the worker to the report', async () => {
    const crash: ReportCrash = {
      exit: { code: null, signal: 'SIGKILL' },
      screenTail: ['CRASH APP READY'],
      timeMs: 42,
    };
    const reporter = new TermwrightReporter({ silent: true });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase('1', 'dies', { state: 'failed', error: 'boom', crashes: [crash] }));
    expect(reporter.tests[0]?.crashes).toEqual([crash]);

    const [result] = toReportResults(reporter.tests);
    expect(result).toMatchObject({ id: '1', crash });
    // Our own bookkeeping does not leak into the report's input.
    expect(result).not.toHaveProperty('flaky');
    expect(result).not.toHaveProperty('crashes');
  });

  it('leaves the crash field out when nothing died', () => {
    const reporter = new TermwrightReporter({ silent: true });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase('1', 'fails', { state: 'failed', error: 'boom' }));
    expect(toReportResults(reporter.tests)[0]).not.toHaveProperty('crash');
  });

  it('does not report twice for one run', async () => {
    const dir = workspace();
    const reporter = new TermwrightReporter({ silent: true, outFile: join(dir, 'once.html') });
    reporter.onTestRunStart();
    reporter.onTestCaseResult(testCase('1', 'fails', { state: 'failed', error: 'boom' }));
    await reporter.onTestRunEnd();
    const first = readFileSync(join(dir, 'once.html'), 'utf8');
    await reporter.onFinished([]);
    expect(readFileSync(join(dir, 'once.html'), 'utf8')).toBe(first);
  });
});
