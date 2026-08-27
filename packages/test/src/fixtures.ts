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

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { join } from 'node:path';
import { expect as globalExpect, test as base } from 'vitest';
import {
  launchTerminal,
  type LaunchOptions,
  type SessionEventRecord,
  type TerminalHarness,
} from '@termwright/driver';
import {
  createRunId,
  parseRunId,
  type ActionId,
  type LogLevel,
  type RunEventJson,
  type SessionId,
  type StepId,
} from '@termwright/protocol';
import type { RemoteResourceLease } from '@termwright/resource-broker/transport';
import { createTraceWriter, type TraceWriter } from '@termwright/trace';
import { connectLiveSession, type LiveSessionConnection } from '@termwright/ui/live-client';
import { getTermwrightConfig, type ResolvedTermwrightConfig, type TraceMode } from './config.js';
import { appendCrashSection, collectCrashes, toReportCrash, type ReportCrash } from './crash.js';
import { collectTestNames } from './declared-tests.js';
import { seedDirectory, type SeedFiles, type SeedTemplate } from './seed.js';
import { mergeOptions, type TermwrightOptions } from './options.js';
import {
  collectLogs,
  createLogCollection,
  logThresholdFailure,
  type LogCollection,
} from './logs.js';
import {
  pruneObsoleteSnapshots,
  resolveUpdateMode,
  snapshotFilePath,
  type SnapshotKind,
} from './snapshot-store.js';
import {
  attachWriter,
  beginStep,
  currentScope,
  currentStepId,
  enterScope,
  type TermwrightScope,
} from './trace-context.js';
import { currentAttemptContext, currentAttemptEventRecorder } from './attempt-context.js';
import { buildTaskMeta, type TermwrightAttemptFailure } from './task-meta.js';
import { markTermwrightTestApi } from './provider.js';

/** What a test may override when launching a program. */
export interface LaunchFixtureOptions extends Omit<LaunchOptions, 'command' | 'operationBudget'> {
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
export interface OpenShellFixtureOptions extends Omit<
  LaunchFixtureOptions,
  'command' | 'shellIntegration'
> {
  /** Shell executable and arguments. Defaults to PowerShell on Windows and `$SHELL -i` or `/bin/sh -i` elsewhere. */
  readonly shell?: readonly string[];
}

/** Runs a titled step; it becomes a marker in the recording and a trace event. */
export interface StepOptions {
  /** Authored identity for a physical Gherkin step. */
  readonly gherkin?: import('@termwright/trace').GherkinStepMetadata;
}
export type StepRunner = <T>(
  title: string,
  body: () => T | Promise<T>,
  options?: StepOptions,
) => Promise<T>;

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
   * test.override({ termwrightOptions: { columns: 120, trace: 'on' } });
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
  'PATH',
  'HOME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'USER',
  'SystemRoot',
  'ComSpec',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
];

interface Session {
  readonly harness: TerminalHarness;
  readonly live: LiveSessionConnection;
  readonly writer: TraceWriter | undefined;
  readonly dir: string | undefined;
  /** Effective policy for this session, which a `launch()` may have overridden. */
  readonly trace: TraceMode;
  /** Trace-writer capacity; PTY/process/endpoint capacity belongs to TerminalSession. */
  readonly traceLease: RemoteResourceLease | undefined;
  readonly runSessionId: SessionId;
  readonly detachJournal: () => void;
}

/**
 * `test` with termwright's fixtures. Use it exactly like Vitest's `test`;
 * `test.step()` is available inside any of its tests.
 */
export const test = markTermwrightTestApi(
  base.extend<TermwrightFixtures>({
    termwrightOptions: {},

    termwright: [
      async ({ task, annotate, onTestFailed }, use) => {
        // `expect` cannot be named in the destructuring pattern. Vitest 4 derives
        // fixture dependencies from that pattern and validates them against its
        // built-ins — task, signal, onTestFailed, onTestFinished, skip, annotate
        // — and `expect` is not one, so naming it fails as an unknown fixture.
        // Rest parameters are rejected outright. The task carries the same
        // context, and it has to be that instance rather than the global one:
        // the global expect would miss a run that is only updating this file's
        // snapshots.
        const expect =
          (task as { readonly context?: { readonly expect?: typeof globalExpect } }).context
            ?.expect ?? globalExpect;
        const config = getTermwrightConfig();
        const testName = fullName(task);
        // The exact runner owns retry/repeat identity; task.result is aggregate
        // state and cannot identify concurrent or repeated native tries.
        const attemptContext = currentAttemptContext();
        attemptContext.budget.enter('fixture');
        const attempt = attemptContext.retry + 1;
        const scope: TermwrightScope = {
          testId: attemptContext.attemptId,
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
            executionId: attemptContext.executionId,
            attemptId: attemptContext.attemptId,
            repeat: attemptContext.repeat,
            retry: attemptContext.retry,
            attempt,
            errors: errors.length === 0 ? [{ message: 'test failed' }] : errors,
            ...(scope.traces.length === 0 ? {} : { traceRefs: [...scope.traces] }),
          };
          task.meta.termwright = {
            ...(task.meta.termwright ?? {}),
            attemptFailures: [
              ...previous.filter((entry) => entry.attemptId !== attemptContext.attemptId),
              failure,
            ].sort((left, right) => left.repeat - right.repeat || left.retry - right.retry),
          };
        });
        const obsolete = sweepObsoleteSnapshots(task.file, config, updateFlagOf(expect));
        let directory: string | undefined;
        const fixture: TermwrightScopeFixture = {
          config,
          get tmpdir(): string {
            // Resolved, because on Windows os.tmpdir() hands back the 8.3 short
            // form ("C:\\Users\\RUNNER~1\\...") while any program launched into this
            // directory reports the long one. Both name the same directory, so a
            // test comparing its shell's cwd against this path would be comparing
            // two spellings of the same place and finding them different.
            // `.native` on purpose: the JS realpath resolves symlinks but leaves
            // 8.3 components alone, so it returns the short form unchanged.
            directory ??= realpathSync.native(mkdtempSync(join(osTmpdir(), 'termwright-')));
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
          attemptContext.budget.mark('cleanup');
          exit();
          if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
          // Merged, not replaced: the `terminal` fixture tears down first and has
          // already recorded what it knows here.
          const added = buildTaskMeta({ traces: scope.traces, obsoleteSnapshots: obsolete });
          if (added !== undefined)
            task.meta.termwright = { ...(task.meta.termwright ?? {}), ...added };
        }
      },
      { auto: true },
    ],

    step: async ({ termwright }, use) => {
      await use(termwright.step);
    },

    terminal: async ({ termwright, termwrightOptions, task, onTestFailed }, use) => {
      const { config } = termwright;
      const scope = currentScope();
      const sessions: Session[] = [];
      const harnesses: TerminalHarness[] = [];
      const attached = new WeakSet<TerminalHarness>();
      const logs = createLogCollection();
      const detachers: (() => void)[] = [];
      // Records this sink refused. The emitter would otherwise downgrade the
      // loss to a session diagnostic, and a dropped authoritative event only
      // surfaces later as a hole in the run manifest, naming the missing id
      // rather than the reason it never arrived.
      const journalLosses: { readonly record: SessionEventRecord; readonly error: unknown }[] = [];
      let threshold: LogLevel | false = mergeOptions(config, termwrightOptions, {}).failOnLogLevel;
      const crashed: ReportCrash[] = [];
      const attemptContext = currentAttemptContext();
      const operationBudget = Object.freeze({
        remaining: (requestedMs: number) =>
          attemptContext.budget.operationTimeout(requestedMs, 'operation'),
      });
      const attempt = attemptContext.retry + 1;
      const collectsTrace = (trace: TraceMode): boolean =>
        trace !== 'off' && (trace !== 'on-first-retry' || attempt === 2);
      const acquireTraceResource = async (
        trace: TraceMode,
      ): Promise<RemoteResourceLease | undefined> =>
        collectsTrace(trace)
          ? await attemptContext.resources.acquire({ traceWriter: 1 })
          : undefined;
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
        preparedTraceLease?: RemoteResourceLease,
      ): Promise<T> => {
        if (attached.has(harness)) {
          throw new TypeError(
            `terminal.attach() received session ${harness.sessionId} more than once`,
          );
        }
        const merged = mergeOptions(config, termwrightOptions, {
          ...(options.trace === undefined ? {} : { trace: options.trace }),
        });
        const screen = harness.screen();
        const command = options.command ?? ['<attached-harness>'];
        const index = sessions.length;
        const recordsTrace = collectsTrace(merged.trace);
        const traceLease = preparedTraceLease ?? (await acquireTraceResource(merged.trace));
        try {
          if (harness.bindOperationBudget === undefined) {
            throw new TypeError('terminal.attach() requires a budget-aware Termwright harness');
          }
          harness.bindOperationBudget(operationBudget);
          await traceLease?.attach([{ resource: 'traceWriter', sessionId: harness.sessionId }]);
        } catch (error) {
          await traceLease?.release();
          throw error;
        }
        const dir = !recordsTrace
          ? undefined
          : traceDir(config, {
              taskId: attemptContext.runnerTaskId,
              name: fullName(task),
              index,
              attemptId: attemptContext.attemptId,
              repeat: attemptContext.repeat,
              retry: attemptContext.retry,
            });
        const runSessionId = canonicalSessionId(harness.sessionId);
        const writer =
          dir === undefined
            ? undefined
            : createTraceWriter(harness, {
                dir,
                command,
                columns: screen.columns,
                rows: screen.rows,
                runIdentity: {
                  invocationId: attemptContext.invocationId,
                  runId: attemptContext.runId,
                  projectId: attemptContext.projectId,
                  ...(attemptContext.shardId === undefined
                    ? {}
                    : { shardId: attemptContext.shardId }),
                  specId: attemptContext.specId,
                  runnerTaskId: attemptContext.runnerTaskId,
                  executionId: attemptContext.executionId,
                  attemptId: attemptContext.attemptId,
                  sessionId: runSessionId,
                },
              });
        const live = connectLiveSession(harness, {
          testId: attemptContext.attemptId,
          currentStepId: () => currentStepId(scope),
        });
        detachers.push(collectLogs(harness, logs).dispose);
        const attemptEvents = currentAttemptEventRecorder();
        const contract = harness.contract();
        const actionIds = new Map<string, ActionId>();
        attemptEvents.record({
          eventClass: 'authoritative',
          type: 'session.started',
          sessionId: runSessionId,
          payload: {
            driverSessionId: harness.sessionId,
            terminalProfile: harness.terminalProfile,
            ...(contract === null ? {} : { contractId: contract.contractId }),
          },
        });
        const detachJournal = harness.events.subscribe(
          {
            fromSequence: 1,
            onGap: (gap) =>
              attemptEvents.record({
                eventClass: 'authoritative',
                type: 'session.event-gap',
                sessionId: runSessionId,
                payload: { ...gap },
              }),
            onError: (error, record) => {
              journalLosses.push({ record, error });
              // Also say it immediately. A record refused after teardown has
              // already collected its failures would otherwise reach nobody, and
              // this is the exact moment the reason still exists.
              process.stderr.write(
                `termwright: the run journal refused a ${record.type} record: ` +
                  `${error instanceof Error ? error.message : String(error)}\n`,
              );
            },
          },
          (record) => {
            if (record.type === 'action-start') {
              const actionId = canonicalActionId(record.payload.actionId, actionIds);
              attemptEvents.record({
                eventClass: 'diagnostic',
                type: 'action.started',
                sessionId: runSessionId,
                actionId,
                ...currentRunStep(scope),
                payload: {
                  api: record.payload.api,
                  ...(record.payload.selector === undefined
                    ? {}
                    : { selector: record.payload.selector }),
                },
              });
            } else if (record.type === 'action') {
              const actionId = canonicalActionId(record.payload.actionId, actionIds);
              attemptEvents.record({
                eventClass: 'authoritative',
                type: 'action.finished',
                sessionId: runSessionId,
                actionId,
                ...currentRunStep(scope),
                payload: jsonPayload({
                  api: record.payload.api,
                  ok: record.payload.ok,
                  ...(record.payload.selector === undefined
                    ? {}
                    : { selector: record.payload.selector }),
                  ...(record.payload.ref === undefined ? {} : { ref: record.payload.ref }),
                  ...(record.payload.error === undefined
                    ? {}
                    : { error: record.payload.error.slice(0, 16_384) }),
                  ...(record.payload.receipt === undefined
                    ? {}
                    : { receipt: record.payload.receipt }),
                }),
              });
            } else if (record.type === 'exit') {
              attemptEvents.record({
                eventClass: 'authoritative',
                type: 'session.exit',
                sessionId: runSessionId,
                phase: 'cleanup',
                payload: {
                  code: record.payload.code,
                  signal: record.payload.signal,
                },
              });
            }
          },
        );
        if (writer !== undefined) attachWriter(scope, writer);
        sessions.push({
          harness,
          live,
          writer,
          dir,
          trace: merged.trace,
          traceLease,
          runSessionId,
          detachJournal,
        });
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
          const defaultShell =
            process.platform === 'win32'
              ? ['pwsh.exe', '-NoLogo', '-NoProfile', '-NoExit']
              : [process.env['SHELL'] ?? '/bin/sh', '-i'];
          const { shell = defaultShell, ...launchOptions } = options;
          if (shell.length === 0)
            throw new TypeError('terminal.openShell() needs a non-empty shell command');
          return factory.launch({
            ...launchOptions,
            command: shell,
            shellIntegration:
              process.platform === 'win32' ? 'termwright-powershell' : 'termwright-posix',
          });
        },
        async launch(options: LaunchFixtureOptions = {}): Promise<TerminalHarness> {
          const merged = mergeOptions(config, termwrightOptions, options, inheritedEnv());
          const command = merged.command;
          if (command === undefined || command.length === 0) {
            throw new TypeError(
              'terminal.launch() needs a command: pass one, set it for this file with ' +
                'test.override({ termwrightOptions: { command } }), or set `command` in defineTermwrightConfig()',
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
          const traceLease = await acquireTraceResource(merged.trace);
          let harness: TerminalHarness | undefined;
          try {
            harness = await launchTerminal({
              ...launchOptions,
              command,
              columns: merged.columns,
              rows: merged.rows,
              ...(merged.terminalProfile === undefined
                ? {}
                : { terminalProfile: merged.terminalProfile }),
              requiredCapabilities: merged.requiredCapabilities,
              cwd,
              env: merged.env,
              timeouts: merged.timeouts,
              operationBudget,
            });
            return await attachHarness(harness, { trace: merged.trace, command }, traceLease);
          } catch (error) {
            await harness?.close().catch(() => undefined);
            await traceLease?.release();
            throw error;
          }
        },
      };

      attemptContext.budget.enter('operation');
      await use(factory);
      attemptContext.budget.mark('diagnostics');

      // Terminate every child while log collectors and trace writers are still
      // attached. TerminalSession.close() final-drains file logs after process
      // exit, so evaluating failOnLogLevel before this barrier is a false green.
      const teardownFailures: unknown[] = [];
      const closed = new Set<Session>();
      for (const session of sessions.reverse()) {
        try {
          // Close the harness even when the live projection fails on its way
          // out. The harness owns the terminal outcome of every action it
          // announced, and the run journal requires each announced action to be
          // closed out; skipping it leaves an action.started that nothing can
          // ever answer, which fails the whole run as incomplete rather than
          // reporting the projection error that actually happened.
          try {
            await session.live.close();
          } finally {
            await session.harness.close();
          }
          closed.add(session);
          currentAttemptEventRecorder().record({
            eventClass: 'authoritative',
            type: 'session.finished',
            sessionId: session.runSessionId,
            phase: 'cleanup',
            payload: { cleanup: 'verified' },
          });
        } catch (error) {
          teardownFailures.push(error);
          currentAttemptEventRecorder().record({
            eventClass: 'authoritative',
            type: 'session.finished',
            sessionId: session.runSessionId,
            phase: 'cleanup',
            payload: {
              cleanup: 'failed',
              detail:
                error instanceof Error
                  ? error.message.slice(0, 16_384)
                  : String(error).slice(0, 16_384),
            },
          });
        } finally {
          session.detachJournal();
        }
      }

      const logFailure = logThresholdFailure(logs.all(), threshold, failed, logs.lostRecords());
      if (logFailure !== undefined) failed = true;
      for (const detach of detachers) detach();

      const sessionMeta = buildTaskMeta({ crashes: crashed, lostLogRecords: logs.lostRecords() });
      if (sessionMeta !== undefined) {
        task.meta.termwright = { ...(task.meta.termwright ?? {}), ...sessionMeta };
      }

      for (const session of sessions) {
        attemptContext.budget.mark('trace-flush');
        const keep =
          session.trace === 'on' ||
          session.trace === 'on-first-retry' ||
          (failed && session.trace === 'retain-on-failure');
        let verifiedTeardown = closed.has(session);
        try {
          if (session.writer !== undefined) {
            if (keep) {
              const archive = await session.writer.finalize({ idleTimeLimit: 2 });
              scope?.traces.push(archive.dir);
            } else {
              session.writer.dispose();
            }
          }
        } catch (error) {
          verifiedTeardown = false;
          teardownFailures.push(error);
        } finally {
          // A failed close/finalize may have left a process or writer alive.
          // Keep the lease held; disconnecting the worker reclaims it fail-closed.
          if (verifiedTeardown) {
            try {
              await session.traceLease?.release();
            } catch (error) {
              teardownFailures.push(error);
            }
          }
        }
      }

      attemptContext.budget.mark('teardown');
      // Report a refused record here, where the cause is still attached to it.
      // Left alone it becomes a missing id in manifest validation long after the
      // worker that could explain it is gone.
      for (const loss of journalLosses) {
        teardownFailures.push(
          new Error(
            `the run journal refused a ${loss.record.type} record for this attempt: ` +
              `${loss.error instanceof Error ? loss.error.message : String(loss.error)}`,
            { cause: loss.error },
          ),
        );
      }
      if (logFailure !== undefined && teardownFailures.length > 0) {
        throw new AggregateError(
          [new Error(logFailure), ...teardownFailures],
          'log policy and terminal teardown failed',
        );
      }
      if (teardownFailures.length > 0)
        throw new AggregateError(teardownFailures, 'terminal teardown failed');
      if (logFailure !== undefined) throw new Error(logFailure);
    },
  }),
);

function canonicalSessionId(value: string): SessionId {
  try {
    return parseRunId('session', value);
  } catch {
    return createRunId('session');
  }
}

function canonicalActionId(value: string, ids: Map<string, ActionId>): ActionId {
  const existing = ids.get(value);
  if (existing !== undefined) return existing;
  let id: ActionId;
  try {
    id = parseRunId('action', value);
  } catch {
    id = createRunId('action');
  }
  ids.set(value, id);
  return id;
}

function jsonPayload(value: unknown): RunEventJson {
  return JSON.parse(JSON.stringify(value)) as RunEventJson;
}

function currentRunStep(scope: TermwrightScope | undefined): { readonly stepId?: StepId } {
  const value = currentStepId(scope);
  return value === undefined ? {} : { stepId: parseRunId('step', value) };
}

async function runStep<T>(
  title: string,
  body: () => T | Promise<T>,
  scope?: TermwrightScope,
  annotate?: (
    message: string,
    type?: string,
    attachment?: { body: string; contentType: string },
  ) => Promise<unknown>,
  options?: StepOptions,
): Promise<T> {
  const active = beginStep(title, options, scope ?? currentScope());
  const publish = async (
    phase: 'start' | 'end',
    status?: 'passed' | 'failed',
    error?: string,
  ): Promise<void> => {
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
 * the current AttemptId installed by the exact runner, so it remains correct
 * under `test.concurrent`, including duplicate authored titles.
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
  readonly suite?:
    { readonly name: string; readonly suite?: unknown; readonly filepath?: string } | undefined;
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
  const state = (
    expect as { getState?: () => { snapshotState?: { _updateSnapshot?: string } } }
  ).getState?.();
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
      pruneObsoleteSnapshots(
        snapshotFilePath(file.filepath, kind, config.snapshotDir),
        declared,
        mode,
      ).keys,
  );
}

interface TraceNaming {
  readonly taskId: string;
  readonly name: string;
  readonly index: number;
  readonly attemptId: string;
  readonly repeat: number;
  readonly retry: number;
}

function traceDir(config: ResolvedTermwrightConfig, naming: TraceNaming): string {
  // Bounded well under the Windows path limit: the rest of the name adds a
  // task id, an attempt id and the repeat/retry pair, and the trace directory
  // then holds files of its own. The slug is for a human reading the
  // directory; the two ids are what make it unique.
  const slug =
    naming.name
      .replace(/[^\w.-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 48) || 'test';
  const taskIdentity = naming.taskId.replace(/[^\w.-]+/gu, '-');
  const identity = naming.attemptId.replace(/^attempt:/u, '');
  const suffix = `-repeat${naming.repeat + 1}-retry${naming.retry + 1}-${identity}`;
  return join(
    config.outputDir,
    'traces',
    `${slug}-${taskIdentity}-${naming.index}${suffix}.twtrace`,
  );
}

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
