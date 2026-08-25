import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import type { Reporter, TestCase, TestRunResult, Vitest } from 'vitest/node';
import { CERTIFIED_VITEST_VERSION } from '@termwright/test/vitest-engine';
import {
  ExactVitestEngine,
  classifyVitestResult,
  hostRelativeFilters,
  removeEmbeddedDefaultReporter,
  vitestSchedulerOverrides,
} from './test-host-engine.js';

describe('exact Vitest adapter seams', () => {
  it('anchors real paths to the declared host root without rewriting substring filters', () => {
    const cwd = process.cwd();
    expect(hostRelativeFilters(['packages/termwright-cli/src/test-host.ts', 'name fragment', ''], cwd)).toEqual([
      resolve(cwd, 'packages/termwright-cli/src/test-host.ts'),
      'name fragment',
      '',
    ]);
  });

  it('removes only implicit default reporters and preserves explicit reporter order', () => {
    class DefaultReporter {}
    class FirstReporter {}
    class SecondReporter {}
    const first = new FirstReporter() as Reporter;
    const second = new SecondReporter() as Reporter;
    const reporters = [first, new DefaultReporter() as Reporter, second];
    removeEmbeddedDefaultReporter({ version: '4.1.11', reporters } as Pick<Vitest, 'version'> & { reporters: Reporter[] });
    expect(reporters).toEqual([first, second]);
  });

  it('treats profile file parallelism as permission and preserves stricter project config', () => {
    expect(vitestSchedulerOverrides({ pool: 'forks', maxWorkers: 4, fileParallelism: true })).toEqual({
      pool: 'forks',
      maxWorkers: 4,
    });
    expect(vitestSchedulerOverrides({ pool: 'forks', maxWorkers: 2, fileParallelism: false })).toEqual({
      pool: 'forks',
      maxWorkers: 2,
      fileParallelism: false,
    });
  });

  it('classifies retries and unhandled errors from structured engine results', () => {
    expect(classifyVitestResult(result([test('passed', 1)]))).toBe('flaky');
    expect(classifyVitestResult(result([test('passed')], [new Error('worker lost')]))).toBe('infrastructure-failed');
    expect(classifyVitestResult(result([test('passed', 1), test('failed')]))).toBe('failed');
    expect(classifyVitestResult(result([test('failed')], [new Error('worker lost')]))).toBe('infrastructure-failed');
  });

  it('adapts native module ids and structured console output without a host', async () => {
    const specifications = [{ moduleId: '/workspace/a.test.ts' }];
    const nativeResult = result([test('passed')]);
    const globTestSpecifications = vi.fn(async () => specifications);
    const runTestSpecifications = vi.fn(async () => nativeResult);
    const reporters: Reporter[] = [];
    const adapter = new ExactVitestEngine({
      version: CERTIFIED_VITEST_VERSION,
      reporters,
      provide: vi.fn(),
      globTestSpecifications,
      runTestSpecifications,
      vite: { watcher: { on: vi.fn(), off: vi.fn() } },
      cancelCurrentRun: vi.fn(),
      close: vi.fn(),
    } as unknown as Vitest);
    const observed: string[] = [];
    adapter.onUserConsoleLog((log) => observed.push(log.content));
    reporters.at(-1)?.onUserConsoleLog?.({ content: 'structured', type: 'stdout', time: 1, size: 10 });
    await expect(adapter.run(new Set(['/workspace/a.test.ts']))).resolves.toBe(nativeResult);
    expect(globTestSpecifications).toHaveBeenCalledWith(['/workspace/a.test.ts']);
    expect(runTestSpecifications).toHaveBeenCalledWith(specifications, true);
    expect(observed).toEqual(['structured']);
  });
});

function test(state: 'passed' | 'failed' | 'skipped', retryCount = 0): TestCase {
  return { result: () => ({ state, retryCount }) } as unknown as TestCase;
}

function result(tests: readonly TestCase[], unhandledErrors: readonly unknown[] = []): TestRunResult {
  return {
    unhandledErrors: [...unhandledErrors],
    testModules: tests.length === 0 ? [] : [{ children: { allTests: function* () { yield* tests; } } } as never],
  };
}
