/**
 * Vitest reporter: collects test outcomes and the traces the fixtures wrote,
 * then renders the self-contained HTML failure report from `@termwright/trace`.
 *
 * Tests that only passed after a retry are classified as **flaky** and reported
 * separately from failures — a flaky test is a different problem from a broken
 * one, and burying it in the pass count is how it stays broken.
 *
 * @example
 * ```ts
 * // vitest.config.ts
 * import TermwrightReporter from '@termwright/test/reporter';
 *
 * export default defineConfig({
 *   test: { reporters: ['default', new TermwrightReporter()] },
 * });
 * ```
 */

import { join } from 'node:path';
import { generateHtmlReport, type ReportTestResult } from '@termwright/trace';
import { getTermwrightConfig } from './config.js';

/** Options for {@link TermwrightReporter}. */
export interface TermwrightReporterOptions {
  /** Destination. Default `<outputDir>/index.html` from the resolved config. */
  readonly outFile?: string;
  /** Include passing tests. Default false: the report exists for failures. */
  readonly includePassed?: boolean;
  /** Document title. Default `termwright`. */
  readonly title?: string;
  /** Suppress the "report written" line on stdout. Default false. */
  readonly silent?: boolean;
}

/** A test as this reporter recorded it. */
export interface CollectedTest extends ReportTestResult {
  /** Passed only after a retry. */
  readonly flaky: boolean;
}

/** Structural view of the Vitest 3 `TestCase` this reporter reads. */
interface TestCaseLike {
  readonly id?: string;
  readonly name?: string;
  readonly fullName?: string;
  readonly module?: { readonly moduleId?: string };
  result?: () => { state?: string; errors?: readonly { message?: string; stack?: string }[] } | undefined;
  diagnostic?: () => { duration?: number; retryCount?: number; flaky?: boolean } | undefined;
  meta?: () => { termwright?: { traces?: readonly string[] } } | undefined;
}

/** Structural view of a legacy task tree, used by the `onFinished` fallback. */
interface TaskLike {
  readonly id?: string;
  readonly type?: string;
  readonly name?: string;
  readonly mode?: string;
  readonly file?: { readonly filepath?: string };
  readonly meta?: { termwright?: { traces?: readonly string[] } };
  readonly result?: { state?: string; duration?: number; retryCount?: number; errors?: readonly { message?: string; stack?: string }[] };
  readonly tasks?: readonly TaskLike[];
}

/**
 * The reporter. Registered as an instance (`new TermwrightReporter()`) or by
 * module path; both forms are supported by Vitest.
 */
export class TermwrightReporter {
  readonly #options: TermwrightReporterOptions;
  #tests = new Map<string, CollectedTest>();
  #generated = false;

  constructor(options: TermwrightReporterOptions = {}) {
    this.#options = options;
  }

  /** Tests collected so far, in completion order. */
  get tests(): readonly CollectedTest[] {
    return [...this.#tests.values()];
  }

  onTestRunStart(): void {
    this.#tests = new Map();
    this.#generated = false;
  }

  onTestCaseResult(testCase: TestCaseLike): void {
    const collected = collect(testCase);
    if (collected !== undefined) this.#tests.set(collected.id, collected);
  }

  async onTestRunEnd(): Promise<void> {
    await this.report();
  }

  /** Legacy hook; only runs when `onTestRunEnd` did not. */
  async onFinished(files: readonly TaskLike[] = []): Promise<void> {
    if (this.#generated) return;
    if (this.#tests.size === 0) {
      for (const test of walk(files)) this.#tests.set(test.id, test);
    }
    await this.report();
  }

  /**
   * Writes the report for the tests collected so far.
   *
   * @returns the report path, or `undefined` when there was nothing worth
   * reporting.
   */
  async report(): Promise<string | undefined> {
    this.#generated = true;
    const config = getTermwrightConfig();
    const all = this.tests;
    const interesting =
      this.#options.includePassed === true
        ? all
        : all.filter((test) => test.status === 'failed' || test.flaky);
    const flaky = all.filter((test) => test.flaky);
    if (interesting.length === 0) return undefined;

    const outFile = this.#options.outFile ?? join(config.outputDir, 'index.html');
    await generateHtmlReport({
      outFile,
      title: this.#options.title ?? 'termwright',
      results: interesting.map(({ flaky: _flaky, ...result }) => result),
    });
    if (this.#options.silent !== true) {
      const failed = all.filter((test) => test.status === 'failed').length;
      const summary = `${failed} failed, ${flaky.length} flaky`;
      process.stdout.write(`\ntermwright report (${summary}): ${outFile}\n`);
      for (const test of flaky) process.stdout.write(`  flaky: ${test.title}\n`);
    }
    return outFile;
  }
}

export default TermwrightReporter;

function collect(testCase: TestCaseLike): (CollectedTest & { id: string }) | undefined {
  const id = testCase.id;
  if (id === undefined) return undefined;
  const result = testCase.result?.();
  const diagnostic = testCase.diagnostic?.();
  const meta = testCase.meta?.();
  const state = result?.state;
  const status = toStatus(state);
  if (status === undefined) return undefined;
  const error = result?.errors?.[0];
  const traces = meta?.termwright?.traces ?? [];
  return {
    id,
    title: testCase.fullName ?? testCase.name ?? id,
    status,
    flaky: diagnostic?.flaky === true || (status === 'passed' && (diagnostic?.retryCount ?? 0) > 0),
    ...(testCase.module?.moduleId === undefined ? {} : { file: testCase.module.moduleId }),
    ...(diagnostic?.duration === undefined ? {} : { durationMs: diagnostic.duration }),
    ...(error === undefined
      ? {}
      : { error: { message: error.message ?? 'test failed', ...(error.stack === undefined ? {} : { stack: error.stack }) } }),
    ...(traces[0] === undefined ? {} : { tracePath: traces[0] }),
  };
}

/** Flattens a legacy file/suite/test tree into collected results. */
function walk(tasks: readonly TaskLike[]): (CollectedTest & { id: string })[] {
  const collected: (CollectedTest & { id: string })[] = [];
  const visit = (task: TaskLike, prefix: readonly string[]): void => {
    const names = task.name === undefined ? prefix : [...prefix, task.name];
    if (task.type === 'test') {
      const status = toStatus(task.result?.state);
      if (status === undefined || task.id === undefined) return;
      const error = task.result?.errors?.[0];
      const traces = task.meta?.termwright?.traces ?? [];
      collected.push({
        id: task.id,
        title: names.join(' > '),
        status,
        flaky: status === 'passed' && (task.result?.retryCount ?? 0) > 0,
        ...(task.file?.filepath === undefined ? {} : { file: task.file.filepath }),
        ...(task.result?.duration === undefined ? {} : { durationMs: task.result.duration }),
        ...(error === undefined
          ? {}
          : { error: { message: error.message ?? 'test failed', ...(error.stack === undefined ? {} : { stack: error.stack }) } }),
        ...(traces[0] === undefined ? {} : { tracePath: traces[0] }),
      });
      return;
    }
    for (const child of task.tasks ?? []) visit(child, names);
  };
  for (const file of tasks) {
    for (const child of file.tasks ?? []) visit(child, []);
  }
  return collected;
}

function toStatus(state: string | undefined): 'passed' | 'failed' | 'skipped' | undefined {
  if (state === 'passed' || state === 'pass') return 'passed';
  if (state === 'failed' || state === 'fail') return 'failed';
  if (state === 'skipped' || state === 'pending' || state === 'todo' || state === 'skip') return 'skipped';
  return undefined;
}
