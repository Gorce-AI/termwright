import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { parseCLI, type Reporter, type TestCase, type TestRunResult, type Vitest } from 'vitest/node';
import { CERTIFIED_VITEST_VERSION } from '@termwright/test/vitest-engine';
import {
  ExactVitestEngine,
  classifyVitestResult,
  hostRelativeFilters,
  removeEmbeddedDefaultReporter,
  vitestCatalogueScope,
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

  it('fails closed if the exact-certified async-leak state surface changes', () => {
    expect(() => new ExactVitestEngine({
      version: CERTIFIED_VITEST_VERSION,
      reporters: [],
      state: { getUnhandledErrors: () => [] },
    } as unknown as Vitest)).toThrow(/async-leak state surface changed/u);
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

  it('distinguishes the default repository catalogue from explicit partial collection', () => {
    const browserConfig = parseCLI([
      'vitest', 'run', '--config', 'packages/ui/vitest.browser.config.ts',
    ], { allowUnknownOptions: true });
    expect(vitestCatalogueScope([], { run: true, coverage: true })).toBe('full');
    expect(vitestCatalogueScope(['packages/ui'], { run: true })).toBe('targeted');
    expect(vitestCatalogueScope(
      browserConfig.filter,
      browserConfig.options as Readonly<Record<string, unknown>>,
    )).toBe('targeted');
    expect(vitestCatalogueScope([], { run: true, project: ['ui'] })).toBe('targeted');
    expect(vitestCatalogueScope([], { run: true, related: ['packages/ui/src/index.ts'] })).toBe('targeted');
    expect(vitestCatalogueScope([], { run: true, testNamePattern: 'browser' })).toBe('targeted');
  });

  it('classifies retries and unhandled errors from structured engine results', () => {
    expect(classifyVitestResult(result([test('passed', 1)]), new Set(['selected']))).toBe('flaky');
    expect(classifyVitestResult(
      result([test('passed')], [new Error('worker lost')]),
      new Set(['selected']),
    )).toBe('infrastructure-failed');
    expect(classifyVitestResult(
      result([test('passed', 1, 'passed'), test('failed', 0, 'failed')]),
      new Set(['passed', 'failed']),
    )).toBe('failed');
    expect(classifyVitestResult(
      result([test('failed')], [new Error('worker lost')]),
      new Set(['selected']),
    )).toBe('infrastructure-failed');
    expect(classifyVitestResult(
      result([test('passed', 0, 'passed'), test('skipped', 0, 'skipped')]),
      new Set(['passed', 'skipped']),
    )).toBe('passed-with-skips');
    expect(classifyVitestResult(result([test('skipped')]), new Set(['selected']))).toBe('skipped');
  });

  it('classifies only tasks selected for the current persistent-host cycle', () => {
    const accumulated = result([test('skipped', 0, 'previous'), test('passed', 0, 'current')]);
    expect(classifyVitestResult(accumulated, new Set(['current']))).toBe('passed');
    expect(classifyVitestResult(accumulated, new Set(['previous']))).toBe('skipped');
  });

  it('fails closed when the current Vitest result is missing or duplicates selected tasks', () => {
    expect(() => classifyVitestResult(
      result([test('passed', 0, 'previous')]),
      new Set(['current']),
    )).toThrow(/1 missing \(current\)/u);
    expect(() => classifyVitestResult(
      result([test('passed', 0, 'current-a')]),
      new Set(['current-a', 'current-b']),
    )).toThrow(/1 missing \(current-b\)/u);
    expect(() => classifyVitestResult(
      result([test('passed', 0, 'current'), test('passed', 0, 'current')]),
      new Set(['current']),
    )).toThrow(/1 duplicated \(current\)/u);
  });

  it('adapts native module ids and structured console output without a host', async () => {
    const specifications = [{ moduleId: '/workspace/a.test.ts' }];
    const nativeResult = result([test('passed')]);
    const globTestSpecifications = vi.fn(async () => specifications);
    const runTestSpecifications = vi.fn(async () => nativeResult);
    const closePool = vi.fn(async () => undefined);
    const reporters: Reporter[] = [];
    const vitest = {
      version: CERTIFIED_VITEST_VERSION,
      reporters,
      provide: vi.fn(),
      globTestSpecifications,
      runTestSpecifications,
      pool: { close: closePool },
      state: { getUnhandledErrors: () => nativeResult.unhandledErrors, leakSet: new Set() },
      vite: { watcher: { on: vi.fn(), off: vi.fn() } },
      cancelCurrentRun: vi.fn(),
      close: vi.fn(),
    } as unknown as Vitest;
    const adapter = new ExactVitestEngine(vitest);
    const observed: string[] = [];
    adapter.onUserConsoleLog((log) => observed.push(log.content));
    reporters.at(-1)?.onUserConsoleLog?.({ content: 'structured', type: 'stdout', time: 1, size: 10 });
    await expect(adapter.run(new Set(['/workspace/a.test.ts']))).resolves.toBe(nativeResult);
    expect(globTestSpecifications).toHaveBeenCalledWith(['/workspace/a.test.ts']);
    expect(runTestSpecifications).toHaveBeenCalledWith(specifications, true);
    expect(closePool).toHaveBeenCalledOnce();
    expect((vitest as unknown as { pool?: unknown }).pool).toBeUndefined();
    expect(observed).toEqual(['structured']);
  });

  it('drains collection workers and reports teardown errors observed at that barrier', async () => {
    const nativeResult = result([test('passed')]);
    const teardownError = new Error('worker transport teardown failed');
    const order: string[] = [];
    let drained = false;
    const vitest = {
      version: CERTIFIED_VITEST_VERSION,
      reporters: [],
      provide: vi.fn(),
      collect: vi.fn(async () => {
        order.push('collect');
        return nativeResult;
      }),
      pool: { close: vi.fn(async () => {
        order.push('drain');
        drained = true;
      }) },
      state: { leakSet: new Set(), getUnhandledErrors: vi.fn(() => {
        order.push('errors');
        return drained ? [teardownError] : [];
      }) },
      vite: { watcher: { on: vi.fn(), off: vi.fn() } },
      cancelCurrentRun: vi.fn(),
      close: vi.fn(),
    } as unknown as Vitest;

    const collection = await new ExactVitestEngine(vitest).collect([]);

    expect(order).toEqual(['collect', 'drain', 'errors']);
    expect(collection.result.unhandledErrors).toEqual([teardownError]);
    expect(collection.tests).toHaveLength(1);
    expect((vitest as unknown as { pool?: unknown }).pool).toBeUndefined();
  });

  it('preserves both the operation and worker-pool teardown errors', async () => {
    const operationError = new Error('collection failed');
    const teardownError = new Error('worker teardown failed');
    const vitest = {
      version: CERTIFIED_VITEST_VERSION,
      reporters: [],
      provide: vi.fn(),
      collect: vi.fn(async () => { throw operationError; }),
      pool: { close: vi.fn(async () => { throw teardownError; }) },
      state: { getUnhandledErrors: vi.fn(() => []), leakSet: new Set() },
      vite: { watcher: { on: vi.fn(), off: vi.fn() } },
      cancelCurrentRun: vi.fn(),
      close: vi.fn(),
    } as unknown as Vitest;

    const failure = await new ExactVitestEngine(vitest).collect([]).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([operationError, teardownError]);
    expect((failure as Error).cause).toBe(operationError);
    expect((vitest as unknown as { pool?: unknown }).pool).toBeUndefined();
  });

  it('promotes Vitest async-leak evidence into a non-certifying engine result', async () => {
    const nativeResult = result([test('passed')]);
    const leak = {
      type: 'Timeout',
      filename: '/workspace/leaky.test.ts',
      projectName: 'core',
      stack: 'Error: VITEST_DETECT_ASYNC_LEAKS\n    at leaky.test.ts:4:3',
    };
    const vitest = {
      version: CERTIFIED_VITEST_VERSION,
      reporters: [],
      provide: vi.fn(),
      globTestSpecifications: vi.fn(async () => [{ moduleId: '/workspace/leaky.test.ts' }]),
      runTestSpecifications: vi.fn(async () => nativeResult),
      pool: { close: vi.fn(async () => undefined) },
      state: { getUnhandledErrors: vi.fn(() => []), leakSet: new Set([leak]) },
      vite: { watcher: { on: vi.fn(), off: vi.fn() } },
      cancelCurrentRun: vi.fn(),
      close: vi.fn(),
    } as unknown as Vitest;

    const resultWithLeak = await new ExactVitestEngine(vitest).run(new Set(['/workspace/leaky.test.ts']));

    expect(resultWithLeak.unhandledErrors).toHaveLength(1);
    expect(String(resultWithLeak.unhandledErrors[0])).toContain(
      'Vitest detected 1 async leak(s) across Timeout from /workspace/leaky.test.ts in project core',
    );
    expect(classifyVitestResult(resultWithLeak, new Set(['selected']))).toBe('infrastructure-failed');
  });
});

function test(state: 'passed' | 'failed' | 'skipped', retryCount = 0, id = 'selected'): TestCase {
  return { id, result: () => ({ state, retryCount }) } as unknown as TestCase;
}

function result(tests: readonly TestCase[], unhandledErrors: readonly unknown[] = []): TestRunResult {
  return {
    unhandledErrors: [...unhandledErrors],
    testModules: tests.length === 0 ? [] : [{ children: { allTests: function* () { yield* tests; } } } as never],
  };
}
