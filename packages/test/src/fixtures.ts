/**
 * Vitest fixtures: a per-test terminal factory with automatic teardown, an
 * isolated working directory and environment, trace collection, and steps.
 *
 * @example
 * ```ts
 * import { test, expect } from '@termwright/test';
 *
 * test('approves the permission dialog', async ({ terminal, step }) => {
 *   const app = await terminal.launch({ command: ['node', 'app.js'] });
 *   await step('approve', async () => {
 *     await app.getByRole('button', { name: 'Approve' }).activate();
 *   });
 *   await expect(app.getByRole('dialog')).not.toBeVisible();
 * });
 * ```
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base } from 'vitest';
import { launchTerminal, type LaunchOptions, type TerminalHarness } from '@termwright/driver';
import type { LogLevel } from '@termwright/protocol';
import { createTraceWriter, type TraceWriter } from '@termwright/trace';
import { getTermwrightConfig, type ResolvedTermwrightConfig } from './config.js';
import { appendCrashSection, collectCrashes, toReportCrash, type ReportCrash } from './crash.js';
import { collectTestNames } from './declared-tests.js';
import { collectLogs, createLogCollection, logThresholdFailure, type LogCollection } from './logs.js';
import {
  beginSnapshotScope,
  pruneObsoleteSnapshots,
  resolveUpdateMode,
  snapshotFilePath,
  type SnapshotKind,
} from './snapshot-store.js';
import { currentScope, enterScope, openStep, scopeKey, type TermwrightScope } from './trace-context.js';
import './task-meta.js';

/** What a test may override when launching a program. */
export interface LaunchFixtureOptions extends Omit<LaunchOptions, 'command'> {
  /** Defaults to `config.command`. */
  readonly command?: readonly string[];
}

/** Runs a titled step; it becomes a marker in the recording and a trace event. */
export type StepRunner = <T>(title: string, body: () => T | Promise<T>) => Promise<T>;

/** Test-scoped services that do not depend on a running terminal. */
export interface TermwrightScopeFixture {
  readonly config: ResolvedTermwrightConfig;
  /** Private directory for this test; created on first access, removed after. */
  readonly tmpdir: string;
  /** Trace archives kept for this test, filled in during teardown. */
  readonly traces: readonly string[];
  readonly step: StepRunner;
}

/** Launches terminals that close themselves when the test ends. */
export interface TerminalFactory {
  launch(options?: LaunchFixtureOptions): Promise<TerminalHarness>;
  /** Sessions launched by this test, in launch order. */
  readonly sessions: readonly TerminalHarness[];
  /** The test's private working directory. */
  readonly tmpdir: string;
  /** Everything the programs of this test logged, oldest first. */
  readonly logs: LogCollection;
  /**
   * Overrides {@link TermwrightConfig.failOnLogLevel} for this test.
   *
   * `false` accepts whatever the program logs — the escape hatch for a test
   * that *expects* an error path to be exercised.
   */
  failOnLogLevel(level: LogLevel | false): void;
}

/** Fixtures added to Vitest's `test`. */
export interface TermwrightFixtures {
  termwright: TermwrightScopeFixture;
  terminal: TerminalFactory;
  step: StepRunner;
}

/** Environment variables inherited by launched programs; everything else is dropped. */
const INHERITED_ENV: readonly string[] = [
  'PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'USER',
  'SystemRoot', 'ComSpec', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP',
];

const attempts = new Map<string, number>();

interface Session {
  readonly harness: TerminalHarness;
  readonly writer: TraceWriter | undefined;
  readonly dir: string | undefined;
}

/**
 * `test` with termwright's fixtures. Use it exactly like Vitest's `test`;
 * `test.step()` is available inside any of its tests.
 */
export const test = base.extend<TermwrightFixtures>({
  termwright: [
    async ({ task, expect }, use) => {
      const config = getTermwrightConfig();
      const testName = fullName(task);
      const scope: TermwrightScope = {
        testId: task.id,
        testName,
        testFile: task.file.filepath,
        config,
        writers: [],
        traces: [],
      };
      beginSnapshotScope();
      const obsolete = sweepObsoleteSnapshots(task.file, config, updateFlagOf(expect));
      let directory: string | undefined;
      const fixture: TermwrightScopeFixture = {
        config,
        get tmpdir(): string {
          directory ??= mkdtempSync(join(osTmpdir(), 'termwright-'));
          return directory;
        },
        get traces(): readonly string[] {
          return scope.traces;
        },
        step: (title, body) => runStep(title, body, scope),
      };
      const exit = enterScope(scope);
      try {
        await use(fixture);
      } finally {
        exit();
        if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
        if (scope.traces.length > 0 || obsolete.length > 0) {
          // Merge: the `terminal` fixture tears down first and may already have
          // recorded crashes here.
          task.meta.termwright = {
            ...(task.meta.termwright ?? {}),
            ...(scope.traces.length > 0 ? { traces: [...scope.traces] } : {}),
            ...(obsolete.length > 0 ? { obsoleteSnapshots: obsolete } : {}),
          };
        }
      }
    },
    { auto: true },
  ],

  step: async ({ termwright }, use) => {
    await use(termwright.step);
  },

  terminal: async ({ termwright, task, onTestFailed }, use) => {
    const { config } = termwright;
    const scope = currentScope(scopeKey(task.file.filepath, fullName(task)));
    const sessions: Session[] = [];
    const harnesses: TerminalHarness[] = [];
    const logs = createLogCollection();
    const detachers: (() => void)[] = [];
    let threshold: LogLevel | false = config.failOnLogLevel;
    const crashed: ReportCrash[] = [];
    const attempt = (attempts.get(task.id) ?? 0) + 1;
    attempts.set(task.id, attempt);
    let failed = false;
    onTestFailed(() => {
      failed = true;
      // A program that died explains the failure better than the assertion
      // that noticed it, so the crash goes into the message the runner prints
      // rather than into a channel only the HTML report reads.
      const crashes = collectCrashes(sessions);
      if (crashes.length === 0) return;
      crashed.push(...crashes.map((crash) => toReportCrash(crash.report)));
      appendCrashSection(task.result?.errors, crashes);
    });

    const factory: TerminalFactory = {
      sessions: harnesses,
      logs,
      failOnLogLevel(level: LogLevel | false): void {
        threshold = level;
      },
      get tmpdir(): string {
        return termwright.tmpdir;
      },
      async launch(options: LaunchFixtureOptions = {}): Promise<TerminalHarness> {
        const command = options.command ?? config.command;
        if (command === undefined || command.length === 0) {
          throw new TypeError(
            'terminal.launch() needs a command: pass one, or set `command` in defineTermwrightConfig()',
          );
        }
        const { expect: _expect, ...driverTimeouts } = config.timeouts;
        const harness = await launchTerminal({
          ...options,
          command,
          columns: options.columns ?? config.columns,
          rows: options.rows ?? config.rows,
          cwd: options.cwd ?? termwright.tmpdir,
          env: { ...inheritedEnv(), ...config.env, ...(options.env ?? {}) },
          timeouts: { ...driverTimeouts, ...(options.timeouts ?? {}) },
        });
        const index = sessions.length;
        const dir =
          config.trace === 'off'
            ? undefined
            : traceDir(config, { taskId: task.id, name: fullName(task), index, attempt });
        const writer =
          dir === undefined
            ? undefined
            : createTraceWriter(harness, {
                dir,
                command,
                columns: options.columns ?? config.columns,
                rows: options.rows ?? config.rows,
              });
        detachers.push(collectLogs(harness, logs).dispose);
        if (writer !== undefined) scope?.writers.push(writer);
        sessions.push({ harness, writer, dir });
        harnesses.push(harness);
        return harness;
      },
    };

    await use(factory);

    // Decided before teardown: a log failure is a failure, so the trace of the
    // session that produced it has to survive `retain-on-failure`.
    const logFailure = logThresholdFailure(logs.all(), threshold, failed);
    if (logFailure !== undefined) failed = true;

    for (const detach of detachers) detach();

    if (crashed.length > 0) {
      task.meta.termwright = { ...(task.meta.termwright ?? {}), crashes: [...crashed] };
    }

    for (const session of sessions.reverse()) {
      const keep = config.trace === 'on' || (failed && config.trace === 'retain-on-failure');
      try {
        await session.harness.close();
      } finally {
        if (session.writer !== undefined) {
          if (keep) {
            const archive = await session.writer.finalize({ idleTimeLimit: 2 });
            scope?.traces.push(archive.dir);
          } else {
            session.writer.dispose();
          }
        }
      }
    }

    if (logFailure !== undefined) throw new Error(logFailure);
  },
});

async function runStep<T>(
  title: string,
  body: () => T | Promise<T>,
  scope?: TermwrightScope,
): Promise<T> {
  const handles = openStep(title, scope ?? currentScope());
  try {
    const result = await body();
    for (const handle of handles) handle.end('passed');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const handle of handles) handle.end('failed', message);
    throw error;
  }
}

/**
 * Runs `body` as a named step: a marker in the recording, a step event in the
 * trace, and a labelled section in the HTML report.
 *
 * This is the free-standing form, used by `test.step()`; it attaches to the
 * most recently started test. Prefer the `step` fixture, which is bound to its
 * own test and therefore stays correct under `test.concurrent`.
 */
export const step: StepRunner = (title, body) => runStep(title, body);

/** `test` plus the static `step` helper. */
export type TermwrightTestAPI = typeof test & { step: StepRunner };

Object.assign(test, { step });

/** Vitest's `it`, extended the same way. */
export const it = test as TermwrightTestAPI;

interface TaskLike {
  readonly id: string;
  readonly name: string;
  readonly suite?: { readonly name: string; readonly suite?: unknown; readonly filepath?: string } | undefined;
  readonly file: { readonly filepath: string };
}

/** `suite > nested suite > test`, matching what `expect.getState()` reports. */
function fullName(task: TaskLike): string {
  const names: string[] = [task.name];
  let parent = task.suite as TaskLike['suite'];
  while (parent !== undefined && parent.filepath === undefined) {
    names.unshift(parent.name);
    parent = parent.suite as TaskLike['suite'];
  }
  return names.join(' > ');
}

const swept = new WeakSet<object>();

/**
 * Vitest's `--update` flag, as the runner recorded it on the test's own
 * `expect`. The fixture has no matcher state of its own, and reading the global
 * `expect` would miss a run where only this test file is being updated.
 */
function updateFlagOf(expect: unknown): string | undefined {
  const state = (expect as { getState?: () => { snapshotState?: { _updateSnapshot?: string } } }).getState?.();
  return state?.snapshotState?._updateSnapshot;
}

/**
 * Reports — and in a writing mode removes — snapshots left behind by tests that
 * no longer exist, once per file per run.
 *
 * Runs on the first test of a file rather than the last: by then Vitest has
 * collected the whole file, so every declared test is known, including the ones
 * this machine skips.
 */
function sweepObsoleteSnapshots(
  file: { readonly filepath: string } & Parameters<typeof collectTestNames>[0],
  config: ResolvedTermwrightConfig,
  updateFlag: string | undefined,
): readonly string[] {
  if (swept.has(file)) return [];
  swept.add(file);
  const declared = collectTestNames(file);
  const mode = config.updateSnapshots ?? resolveUpdateMode(process.env, updateFlag);
  const kinds: readonly SnapshotKind[] = ['semantic', 'cells'];
  return kinds.flatMap(
    (kind) =>
      pruneObsoleteSnapshots(snapshotFilePath(file.filepath, kind, config.snapshotDir), declared, mode).keys,
  );
}

interface TraceNaming {
  readonly taskId: string;
  readonly name: string;
  readonly index: number;
  /** 1 for the first run of a test, 2 for its first retry, and so on. */
  readonly attempt: number;
}

function traceDir(config: ResolvedTermwrightConfig, naming: TraceNaming): string {
  const slug = naming.name.replace(/[^\w.-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'test';
  const suffix = naming.attempt > 1 ? `-retry${naming.attempt - 1}` : '';
  return join(config.outputDir, 'traces', `${slug}-${naming.taskId}-${naming.index}${suffix}.twtrace`);
}

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
