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
import {
  connectLiveSession,
  type LiveSessionConnection,
} from '@termwright/ui/live-client';
import { getTermwrightConfig, type ResolvedTermwrightConfig, type TraceMode } from './config.js';
import { appendCrashSection, collectCrashes, toReportCrash, type ReportCrash } from './crash.js';
import { collectTestNames } from './declared-tests.js';
import { seedDirectory, type SeedFiles, type SeedTemplate } from './seed.js';
import { mergeOptions, type TermwrightOptions } from './options.js';
import { collectLogs, createLogCollection, logThresholdFailure, type LogCollection } from './logs.js';
import {
  beginSnapshotScope,
  pruneObsoleteSnapshots,
  resolveUpdateMode,
  snapshotFilePath,
  type SnapshotKind,
} from './snapshot-store.js';
import { attachWriter, beginStep, currentScope, currentStepId, enterScope, scopeKey, type TermwrightScope } from './trace-context.js';
import { buildTaskMeta, type TermwrightAttemptFailure } from './task-meta.js';
import { markTermwrightTestApi } from './provider.js';

/** What a test may override when launching a program. */
export interface LaunchFixtureOptions extends Omit<LaunchOptions, 'command'> {
  /** Defaults to `config.command`. */
  readonly command?: readonly string[];
  /**
   * Files to create in the working directory before the program starts, keyed
   * by relative path. Directories are created as needed.
   *
   * @example
   * ```ts
   * await terminal.launch({
   *   files: { 'config.json': '{"theme":"dark"}', 'notes/todo.md': '- write tests\n' },
   * });
   * ```
   */
  readonly files?: SeedFiles;
  /**
   * A directory to copy in first, so a test can start from a whole project and
   * change only what it is about. `files` are written over it.
   */
  readonly template?: SeedTemplate | string;
  /** Trace policy for this session, overriding the file's and the project's. */
  readonly trace?: TraceMode;
}

/** Options for adopting a harness created by a framework component helper. */
export interface AttachFixtureOptions {
  /** Trace policy for this session, overriding the file's and project's. */
  readonly trace?: TraceMode;
  /** Command label stored in the trace metadata. */
  readonly command?: readonly string[];
}

/** Options for a Termwright-integrated interactive shell. */
export interface OpenShellFixtureOptions extends Omit<LaunchFixtureOptions, 'command' | 'shellIntegration'> {
  /** Shell executable and arguments. Defaults to PowerShell on Windows and `$SHELL -i` or `/bin/sh -i` elsewhere. */
  readonly shell?: readonly string[];
}

/** Runs a titled step; it becomes a marker in the recording and a trace event. */
export interface StepOptions {
  /** Authored identity for a physical Gherkin step. */
  readonly gherkin?: import('@termwright/trace').GherkinStepMetadata;
}
export type StepRunner = <T>(title: string, body: () => T | Promise<T>, options?: StepOptions) => Promise<T>;

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
  /** Opens an interactive shell with exact command boundaries. */
  openShell(options?: OpenShellFixtureOptions): Promise<TerminalHarness>;
  /**
   * Adopts an existing harness for this test.
   *
   * The fixture collects its logs, publishes it to the Runner, records its
   * trace, and closes it during teardown. This works with every component
   * helper that returns the shared `TerminalHarness` contract.
   */
  attach<T extends TerminalHarness>(harness: T, options?: AttachFixtureOptions): Promise<T>;
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
  /**
   * Options for this file or suite, the equivalent of Playwright's `test.use()`:
   *
   * ```ts
   * test.scoped({ termwrightOptions: { columns: 120, trace: 'on' } });
   * ```
   *
   * They sit between the project configuration and a `launch()` call, merged
   * key by key — scoping one option keeps the rest.
   */
  termwrightOptions: TermwrightOptions;
  termwright: TermwrightScopeFixture;
  terminal: TerminalFactory;
  step: StepRunner;
}

/** Environment variables inherited by launched programs; everything else is dropped. */
const INHERITED_ENV: readonly string[] = [
  'PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'USER',
  'SystemRoot', 'ComSpec', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP',
];

interface Session {
  readonly harness: TerminalHarness;
  readonly live: LiveSessionConnection;
  readonly writer: TraceWriter | undefined;
  readonly dir: string | undefined;
  /** Effective policy for this session, which a `launch()` may have overridden. */
  readonly trace: TraceMode;
}

/**
 * `test` with termwright's fixtures. Use it exactly like Vitest's `test`;
 * `test.step()` is available inside any of its tests.
 */
export const test = markTermwrightTestApi(base.extend<TermwrightFixtures>({
  termwrightOptions: {},

  termwright: [
    async ({ task, expect, annotate, onTestFailed }, use) => {
      const config = getTermwrightConfig();
      const testName = fullName(task);
      // Vitest owns retry scheduling and increments retryCount between native
      // attempts. Deriving the number from it also resets cleanly for watch
      // reruns, unlike a process-global counter keyed by task id.
      const attempt = (task.result?.retryCount ?? 0) + 1;
      const scope: TermwrightScope = {
        testId: task.id,
        testName,
        testFile: task.file.filepath,
        config,
        writers: [],
        traces: [],
      };
      onTestFailed(() => {
        const previous = task.meta.termwright?.attemptFailures ?? [];
        const errors = (task.result?.errors ?? []).map((error) => ({
          message: error.message ?? 'test failed',
          ...(error.stack === undefined ? {} : { stack: error.stack }),
        }));
        const failure: TermwrightAttemptFailure = {
          attempt,
          errors: errors.length === 0 ? [{ message: 'test failed' }] : errors,
          ...(scope.traces.length === 0 ? {} : { traceRefs: [...scope.traces] }),
        };
        task.meta.termwright = {
          ...(task.meta.termwright ?? {}),
          attemptFailures: [...previous.filter((entry) => entry.attempt < attempt), failure]
            .sort((left, right) => left.attempt - right.attempt),
        };
      });
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
        step: (title, body, options) => runStep(title, body, scope, annotate, options),
      };
      const exit = enterScope(scope);
      try {
        await use(fixture);
      } finally {
        exit();
        if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
        // Merged, not replaced: the `terminal` fixture tears down first and has
        // already recorded what it knows here.
        const added = buildTaskMeta({ traces: scope.traces, obsoleteSnapshots: obsolete });
        if (added !== undefined) task.meta.termwright = { ...(task.meta.termwright ?? {}), ...added };
      }
    },
    { auto: true },
  ],

  step: async ({ termwright }, use) => {
    await use(termwright.step);
  },

  terminal: async ({ termwright, termwrightOptions, task, onTestFailed }, use) => {
    const { config } = termwright;
    const scope = currentScope(scopeKey(task.file.filepath, fullName(task)));
    const sessions: Session[] = [];
    const harnesses: TerminalHarness[] = [];
    const attached = new WeakSet<TerminalHarness>();
    const logs = createLogCollection();
    const detachers: (() => void)[] = [];
    let threshold: LogLevel | false =
      mergeOptions(config, termwrightOptions, {}).failOnLogLevel;
    const crashed: ReportCrash[] = [];
    const attempt = (task.result?.retryCount ?? 0) + 1;
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

    const attachHarness = async <T extends TerminalHarness>(
      harness: T,
      options: AttachFixtureOptions,
    ): Promise<T> => {
      if (attached.has(harness)) {
        throw new TypeError(`terminal.attach() received session ${harness.sessionId} more than once`);
      }
      const merged = mergeOptions(config, termwrightOptions, {
        ...(options.trace === undefined ? {} : { trace: options.trace }),
      });
      const screen = harness.screen();
      const command = options.command ?? ['<attached-harness>'];
      const index = sessions.length;
      const collectsTrace = merged.trace !== 'off' && (merged.trace !== 'on-first-retry' || attempt === 2);
      const dir = !collectsTrace
        ? undefined
        : traceDir(config, { taskId: task.id, name: fullName(task), index, attempt });
      const writer = dir === undefined
        ? undefined
        : createTraceWriter(harness, {
            dir,
            command,
            columns: screen.columns,
            rows: screen.rows,
          });
      const live = connectLiveSession(harness, {
        testId: task.id,
        currentStepId: () => currentStepId(scope),
      });
      detachers.push(collectLogs(harness, logs).dispose);
      if (writer !== undefined) attachWriter(scope, writer);
      sessions.push({ harness, live, writer, dir, trace: merged.trace });
      harnesses.push(harness);
      attached.add(harness);
      return harness;
    };

    const factory: TerminalFactory = {
      sessions: harnesses,
      logs,
      failOnLogLevel(level: LogLevel | false): void {
        threshold = level;
      },
      get tmpdir(): string {
        return termwright.tmpdir;
      },
      attach<T extends TerminalHarness>(
        harness: T,
        options: AttachFixtureOptions = {},
      ): Promise<T> {
        return attachHarness(harness, options);
      },
      async openShell(options: OpenShellFixtureOptions = {}): Promise<TerminalHarness> {
        const defaultShell = process.platform === 'win32'
          ? ['pwsh.exe', '-NoLogo', '-NoProfile', '-NoExit']
          : [process.env['SHELL'] ?? '/bin/sh', '-i'];
        const { shell = defaultShell, ...launchOptions } = options;
        if (shell.length === 0) throw new TypeError('terminal.openShell() needs a non-empty shell command');
        return factory.launch({
          ...launchOptions,
          command: shell,
          shellIntegration: process.platform === 'win32' ? 'termwright-powershell' : 'termwright-posix',
        });
      },
      async launch(options: LaunchFixtureOptions = {}): Promise<TerminalHarness> {
        const merged = mergeOptions(config, termwrightOptions, options, inheritedEnv());
        const command = merged.command;
        if (command === undefined || command.length === 0) {
          throw new TypeError(
            'terminal.launch() needs a command: pass one, set it for this file with ' +
              'test.scoped({ termwrightOptions: { command } }), or set `command` in defineTermwrightConfig()',
          );
        }
        const { files, template, trace: _trace, ...launchOptions } = options;
        const cwd = options.cwd ?? termwright.tmpdir;
        if (files !== undefined || template !== undefined) {
          // Before the program starts: a program that reads its config at
          // startup must find it there, not a moment later.
          seedDirectory(cwd, {
            ...(files === undefined ? {} : { files }),
            ...(template === undefined ? {} : { template }),
          });
        }
        const harness = await launchTerminal({
          ...launchOptions,
          command,
          columns: merged.columns,
          rows: merged.rows,
          ...(merged.terminalProfile === undefined ? {} : { terminalProfile: merged.terminalProfile }),
          cwd,
          env: merged.env,
          timeouts: merged.timeouts,
        });
        return attachHarness(harness, { trace: merged.trace, command });
      },
    };

    await use(factory);

    // Decided before teardown: a log failure is a failure, so the trace of the
    // session that produced it has to survive `retain-on-failure`.
    const logFailure = logThresholdFailure(logs.all(), threshold, failed, logs.lostRecords());
    if (logFailure !== undefined) failed = true;

    for (const detach of detachers) detach();

    const sessionMeta = buildTaskMeta({ crashes: crashed, lostLogRecords: logs.lostRecords() });
    if (sessionMeta !== undefined) {
      task.meta.termwright = { ...(task.meta.termwright ?? {}), ...sessionMeta };
    }

    for (const session of sessions.reverse()) {
      const keep = session.trace === 'on' || session.trace === 'on-first-retry' || (failed && session.trace === 'retain-on-failure');
      try {
        // Detach first so terminal shutdown cannot publish late output into a
        // run which Vitest is already finishing. Socket teardown is bounded
        // and fail-open inside the client.
        await session.live.close();
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
}));

async function runStep<T>(
  title: string,
  body: () => T | Promise<T>,
  scope?: TermwrightScope,
  annotate?: (message: string, type?: string, attachment?: { body: string; contentType: string }) => Promise<unknown>,
  options?: StepOptions,
): Promise<T> {
  const active = beginStep(title, options, scope ?? currentScope());
  const publish = async (phase: 'start' | 'end', status?: 'passed' | 'failed', error?: string): Promise<void> => {
    if (annotate === undefined) return;
    await annotate('', 'termwright:step', {
      body: JSON.stringify({
        title,
        phase,
        ...(active.stepId === undefined ? {} : { stepId: active.stepId }),
        ...(status === undefined ? {} : { status }),
        ...(error === undefined ? {} : { error }),
        ...(options?.gherkin === undefined ? {} : { gherkin: options.gherkin }),
      }),
      contentType: 'application/json',
    });
  };
  await publish('start');
  try {
    const result = await body();
    active.end('passed');
    await publish('end', 'passed');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    active.end('failed', message);
    await publish('end', 'failed', message);
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
