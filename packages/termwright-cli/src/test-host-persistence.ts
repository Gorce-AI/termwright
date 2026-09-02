/** Durable journal, manifest, and bounded finalization contracts for one host run. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  RUN_MANIFEST_VERSION,
  beginRunManifest,
  type NativeRunAttempt,
  type RunManifest,
  type RunResourceTelemetry,
  type RunManifestTransaction,
  type RunManifestWriter,
  type RunStartProvenance,
} from '@termwright/run-history';
import {
  RunEventJournal,
  type InvocationId,
  type RunEvent,
  type RunEventProducer,
  type RunId,
  type TerminalRunState,
} from '@termwright/protocol';
import { CERTIFIED_VITEST_VERSION } from './test-host-engine.js';
import type { TermwrightResourceProfile } from './resource-profiles.js';

const executeFile = promisify(execFile);
const MAX_RUNTIME_TIMER_MS = 2_147_483_647;
const CI_PROVENANCE_KEYS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITHUB_RUN_ID',
  'GITHUB_RUN_ATTEMPT',
  'GITHUB_WORKFLOW',
  'GITHUB_JOB',
  'GITLAB_CI',
  'CI_PIPELINE_ID',
  'CI_JOB_ID',
  'BUILDKITE',
  'BUILDKITE_BUILD_ID',
  'TF_BUILD',
  'BUILD_BUILDID',
  'JENKINS_URL',
  'BUILD_ID',
] as const;

export interface TermwrightHostDeadlineRuntime {
  readonly now: () => number;
  readonly schedule: (delayMs: number, elapsed: () => void) => () => void;
}

export const SYSTEM_HOST_DEADLINE_RUNTIME: TermwrightHostDeadlineRuntime = Object.freeze({
  now: () => performance.now(),
  schedule(delayMs: number, elapsed: () => void) {
    const timer = setTimeout(elapsed, delayMs);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
});

export class TermwrightHostTimeoutError extends Error {
  readonly code = 'TW_HOST_TIMEOUT';
  constructor(
    readonly phase: string,
    readonly totalMs: number,
  ) {
    super(`Termwright native host exceeded its ${totalMs} ms total deadline during ${phase}`);
    this.name = 'TermwrightHostTimeoutError';
  }
}

/** A timed-out startup could not prove that its resource was released. */
export class TermwrightHostStartupCleanupError extends AggregateError {
  readonly code = 'TW_HOST_STARTUP_CLEANUP';
  constructor(timeout: TermwrightHostTimeoutError, cleanup: unknown) {
    super([timeout, cleanup], `${timeout.phase} did not abort cleanly before the host deadline`);
    this.name = 'TermwrightHostStartupCleanupError';
  }
}

/** One monotonic run deadline split into execution and reserved finalization phases. */
export class HostRunBudget {
  readonly #startedAt: number;
  readonly #deadlineAt: number;
  readonly #executionDeadlineAt: number;

  constructor(
    readonly totalMs: number,
    readonly finalizationReserveMs: number,
    readonly runtime: TermwrightHostDeadlineRuntime = SYSTEM_HOST_DEADLINE_RUNTIME,
  ) {
    positiveFinite(totalMs, 'run timeout');
    positiveFinite(finalizationReserveMs, 'host finalization reserve');
    if (totalMs > MAX_RUNTIME_TIMER_MS)
      throw new TypeError(`run timeout must not exceed ${MAX_RUNTIME_TIMER_MS} ms`);
    if (finalizationReserveMs >= totalMs)
      throw new TypeError('host finalization reserve must be smaller than the total run timeout');
    this.#startedAt = runtime.now();
    this.#deadlineAt = this.#startedAt + totalMs;
    this.#executionDeadlineAt = this.#deadlineAt - finalizationReserveMs;
  }

  /** Elapsed time on the same monotonic clock that owns the run deadline. */
  elapsedMs(): number {
    const elapsed = this.runtime.now() - this.#startedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      throw new Error('host monotonic clock regressed during the run');
    }
    return elapsed;
  }

  /** Remaining execution time for scheduler work that precedes an Attempt. */
  executionRemainingMs(): number {
    return Math.max(0, this.#executionDeadlineAt - this.runtime.now());
  }

  /** Remaining total time, used only as the scheduler admission backstop. */
  finalizationRemainingMs(): number {
    return Math.max(0, this.#deadlineAt - this.runtime.now());
  }

  execution<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    return startWithinHostDeadline(
      operation,
      this.#executionDeadlineAt,
      phase,
      this.totalMs,
      this.runtime,
    );
  }

  finalization<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    return startWithinHostDeadline(operation, this.#deadlineAt, phase, this.totalMs, this.runtime);
  }

  async startResource<T extends { close(): Promise<void> }>(
    phase: string,
    start: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let startup: Promise<T> | undefined;
    try {
      return await startWithinHostDeadline(
        () => {
          startup = start(controller.signal);
          return startup;
        },
        this.#executionDeadlineAt,
        phase,
        this.totalMs,
        this.runtime,
        () => controller.abort(),
      );
    } catch (error) {
      if (
        !(error instanceof TermwrightHostTimeoutError) ||
        !controller.signal.aborted ||
        startup === undefined
      )
        throw error;
      const pendingStartup = startup;
      const cleanup = (async () => {
        let resource: T;
        try {
          resource = await pendingStartup;
        } catch (startupError) {
          if (controller.signal.aborted && isAbortError(startupError)) return;
          throw startupError;
        }
        await resource.close();
      })();
      void cleanup.catch(() => undefined);
      try {
        await this.finalization(`${phase} abort`, () => cleanup);
      } catch (cleanupError) {
        throw new TermwrightHostStartupCleanupError(error, cleanupError);
      }
      throw error;
    }
  }
}

/** Canonical event store plus best-effort projection for a single run. */
export class RunEventPersistence {
  readonly #journal: RunEventJournal;
  readonly #recorded: RunEvent[] = [];
  readonly #persisted: RunEvent[] = [];
  readonly #sink: (events: readonly RunEvent[]) => void | Promise<void>;
  readonly #observer: ((event: RunEvent) => void) | undefined;
  #sinkCalls = 0;

  constructor(options: {
    readonly invocationId: InvocationId;
    readonly runId: RunId;
    readonly gapProducer: RunEventProducer;
    readonly sink: (events: readonly RunEvent[]) => void | Promise<void>;
    readonly observer?: (event: RunEvent) => void;
  }) {
    this.#journal = new RunEventJournal({
      invocationId: options.invocationId,
      runId: options.runId,
      gapProducer: options.gapProducer,
    });
    this.#sink = options.sink;
    this.#observer = options.observer;
  }

  get recorded(): readonly RunEvent[] {
    return this.#recorded;
  }
  get persisted(): readonly RunEvent[] {
    return this.#persisted;
  }

  metrics(): Readonly<{
    acceptedEvents: number;
    acceptedBytes: number;
    sinkCalls: number;
    peakBacklogEvents: number;
    peakBacklogBytes: number;
  }> {
    return Object.freeze({
      acceptedEvents: this.#journal.acceptedEvents,
      acceptedBytes: this.#journal.acceptedBytes,
      sinkCalls: this.#sinkCalls,
      peakBacklogEvents: this.#journal.peakPending,
      peakBacklogBytes: this.#journal.peakPendingBytes,
    });
  }

  append(event: RunEvent): ReturnType<RunEventJournal['append']> {
    const result = this.#journal.append(event);
    if (!result.ok) return result;
    this.#recorded.push(event);
    try {
      this.#observer?.(event);
    } catch {
      /* Projections cannot change the certified result. */
    }
    return result;
  }

  async flush(): Promise<void> {
    const barrier = this.#journal.barrier();
    await this.#journal.flushThrough(barrier, async (events) => {
      await this.#sink(events);
      this.#sinkCalls += 1;
      this.#persisted.push(...events);
    });
  }
}

export type PersistedSpec = RunManifest['specs'][number];
export type PersistedAttempt = NativeRunAttempt;

export class RunHistoryPersistence {
  readonly #transaction: RunManifestTransaction;

  private constructor(transaction: RunManifestTransaction) {
    this.#transaction = transaction;
  }

  get start(): RunStartProvenance {
    return this.#transaction.start;
  }

  static async begin(options: {
    readonly invocationId: InvocationId;
    readonly runId: RunId;
    readonly startedAt: number;
    readonly cwd: string;
    readonly runsDir: string;
    readonly engineVersion: string;
    readonly resourceProfile: TermwrightResourceProfile;
    readonly totalRunMs: number;
    readonly finalizationReserveMs: number;
    readonly writer?: RunManifestWriter;
    /** Test-host seam: production omits this and captures the repository itself. */
    readonly gitProvenance?: RunStartProvenance['git'];
  }): Promise<RunHistoryPersistence> {
    const start: RunStartProvenance = Object.freeze({
      invocationId: options.invocationId,
      runId: options.runId,
      startedAt: options.startedAt,
      engine: Object.freeze({
        name: 'vitest' as const,
        version: options.engineVersion,
        certification: `termwright-vitest-${CERTIFIED_VITEST_VERSION}`,
      }),
      runtime: Object.freeze({
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      }),
      resources: Object.freeze({
        profile: options.resourceProfile.name,
        scheduler: Object.freeze({ ...options.resourceProfile.scheduler }),
        capacities: Object.freeze({ ...options.resourceProfile.capacities }),
        perAttempt: Object.freeze({ ...(options.resourceProfile.perAttempt ?? {}) }),
        perTerminal: Object.freeze({ ...options.resourceProfile.perTerminal }),
        ...(options.resourceProfile.hostCapacity === undefined
          ? {}
          : { hostCapacity: options.resourceProfile.hostCapacity }),
      }),
      timeouts: Object.freeze({
        totalRunMs: options.totalRunMs,
        finalizationReserveMs: options.finalizationReserveMs,
      }),
      ci: Object.freeze(captureCiProvenance(process.env)),
      git:
        options.gitProvenance === undefined
          ? await captureGitProvenance(options.cwd)
          : options.gitProvenance,
    });
    const transaction = await beginRunManifest(options.runsDir, start, {
      ...(options.writer === undefined ? {} : { writer: options.writer }),
    });
    return new RunHistoryPersistence(transaction);
  }

  prepare(input: {
    readonly status: TerminalRunState;
    readonly specs: readonly PersistedSpec[];
    readonly attempts: readonly PersistedAttempt[];
    readonly events: readonly RunEvent[];
    readonly telemetry: RunResourceTelemetry;
    readonly durationMs: number;
    readonly finishedAt?: number;
  }): Promise<void> {
    return this.#transaction.prepare(createRunManifest(this.start, input));
  }

  async commitPrepared(): Promise<void> {
    await this.#transaction.commitPrepared();
  }
}

export function createRunManifest(
  start: RunStartProvenance,
  input: {
    readonly status: TerminalRunState;
    readonly specs: readonly PersistedSpec[];
    readonly attempts: readonly PersistedAttempt[];
    readonly events: readonly RunEvent[];
    readonly telemetry: RunResourceTelemetry;
    readonly durationMs: number;
    readonly finishedAt?: number;
  },
): RunManifest {
  return Object.freeze({
    ...start,
    v: RUN_MANIFEST_VERSION,
    finishedAt: input.finishedAt ?? Date.now(),
    durationMs: input.durationMs,
    status: input.status,
    specs: Object.freeze(input.specs.map((spec) => Object.freeze({ ...spec }))),
    attempts: Object.freeze(input.attempts.map((attempt) => Object.freeze({ ...attempt }))),
    telemetry: Object.freeze({ ...input.telemetry }),
    events: Object.freeze([...input.events]),
  });
}

export function captureCiProvenance(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of CI_PROVENANCE_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== '') result[key] = value.slice(0, 16_384);
  }
  return result;
}

async function captureGitProvenance(cwd: string): Promise<RunStartProvenance['git']> {
  const commit = await gitValue(cwd, ['rev-parse', 'HEAD']);
  if (commit === null) return null;
  const [details, branch] = await Promise.all([
    gitValue(cwd, ['show', '-s', '--format=%s%x00%an', commit]),
    gitValue(cwd, ['symbolic-ref', '--short', 'HEAD']),
  ]);
  if (details === null || branch === null) return null;
  const separator = details.indexOf('\0');
  if (separator <= 0 || separator === details.length - 1) return null;
  return Object.freeze({
    commit,
    message: details.slice(0, separator),
    author: details.slice(separator + 1),
    branch,
  });
}

async function gitValue(cwd: string, arguments_: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await executeFile('git', [...arguments_], {
      cwd,
      timeout: 2_000,
      windowsHide: true,
      maxBuffer: 64 * 1_024,
    });
    const value = stdout.trim();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

export async function withinHostDeadline<T>(
  operation: Promise<T>,
  deadlineAt: number,
  phase: string,
  totalMs: number,
  runtime: TermwrightHostDeadlineRuntime,
  onElapsed?: () => void,
): Promise<T> {
  const remaining = deadlineAt - runtime.now();
  if (remaining <= 0) {
    void operation.catch(() => undefined);
    throw new TermwrightHostTimeoutError(phase, totalMs);
  }
  let cancelTimer: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        cancelTimer = runtime.schedule(remaining, () => {
          reject(new TermwrightHostTimeoutError(phase, totalMs));
          onElapsed?.();
        });
      }),
    ]);
  } finally {
    cancelTimer?.();
  }
}

function startWithinHostDeadline<T>(
  operation: () => Promise<T>,
  deadlineAt: number,
  phase: string,
  totalMs: number,
  runtime: TermwrightHostDeadlineRuntime,
  onElapsed?: () => void,
): Promise<T> {
  if (runtime.now() >= deadlineAt)
    return Promise.reject(new TermwrightHostTimeoutError(phase, totalMs));
  return withinHostDeadline(operation(), deadlineAt, phase, totalMs, runtime, onElapsed);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
function positiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new TypeError(`${label} must be a positive finite number`);
}
