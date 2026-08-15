import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Reporter } from 'vitest/node';
import { TermwrightReporter } from './reporter.js';

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
  readonly state?: string;
  readonly retryCount?: number;
  readonly flaky?: boolean;
  readonly traces?: readonly string[];
  readonly error?: string;
}

function testCase(id: string, fullName: string, options: CaseOptions = {}): Parameters<TermwrightReporter['onTestCaseResult']>[0] {
  return {
    id,
    fullName,
    module: { moduleId: '/repo/src/login.test.ts' },
    result: () => ({
      state: options.state ?? 'passed',
      ...(options.error === undefined ? {} : { errors: [{ message: options.error, stack: 'at x' }] }),
    }),
    diagnostic: () => ({
      duration: 12,
      retryCount: options.retryCount ?? 0,
      ...(options.flaky === undefined ? {} : { flaky: options.flaky }),
    }),
    meta: () => (options.traces === undefined ? {} : { termwright: { traces: options.traces } }),
  };
}

describe('TermwrightReporter', () => {
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
