import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseRunId,
  RunEventStreamValidator,
  validateRunEvent,
  type AttemptId,
  type ExecutionId,
  type InvocationId,
  type ProjectId,
  type RunId,
  type RunnerTaskId,
  type RunEvent,
  type SpecId,
} from '@termwright/protocol/run-events';

export const RUN_MANIFEST_VERSION = 2 as const;
export const RUN_HISTORY_COMMIT_VERSION = 1 as const;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

export type NativeRunStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'cancelled' | 'crashed' | 'infrastructure-failed' | 'incomplete';
export interface RunStartProvenance {
  readonly invocationId: InvocationId;
  readonly runId: RunId;
  readonly startedAt: number;
  readonly engine: { readonly name: 'vitest'; readonly version: string; readonly certification: string };
  readonly runtime: { readonly node: string; readonly platform: string; readonly arch: string };
  readonly resources: {
    readonly profile: string;
    readonly scheduler: {
      readonly pool: string;
      readonly maxWorkers: number;
      readonly fileParallelism: boolean;
    };
    readonly capacities: Readonly<Record<string, number>>;
    readonly perTerminal: Readonly<Record<string, number>>;
  };
  readonly timeouts: {
    readonly totalRunMs: number;
    readonly finalizationReserveMs: number;
  };
  readonly ci: Readonly<Record<string, string>>;
  readonly git: null | { readonly commit: string; readonly message: string; readonly author: string; readonly branch: string };
}
export interface NativeRunAttempt {
  readonly attemptId: AttemptId;
  readonly executionId: ExecutionId;
  readonly runnerTaskId: RunnerTaskId;
  readonly projectId: ProjectId;
  readonly specId: SpecId;
  readonly nativeTaskId: string;
  readonly repeat: number;
  readonly retry: number;
  readonly status: 'passed' | 'failed' | 'skipped' | 'incomplete';
  readonly durationMs: number | null;
}
export interface NativeRunSpec {
  readonly runnerTaskId: RunnerTaskId;
  readonly specId: SpecId;
  readonly projectId: ProjectId;
  readonly nativeTaskId: string;
  readonly file: string;
  readonly fullName: string;
}
export interface RunManifest extends RunStartProvenance {
  readonly v: typeof RUN_MANIFEST_VERSION;
  readonly finishedAt: number;
  readonly status: NativeRunStatus;
  readonly specs: readonly NativeRunSpec[];
  readonly attempts: readonly NativeRunAttempt[];
  /** Canonical run journal; external reporters are projections of this log. */
  readonly events: readonly RunEvent[];
}
export type RunHistoryRecord =
  | { readonly state: 'complete'; readonly runId: RunId; readonly manifest: RunManifest }
  | { readonly state: 'incomplete'; readonly runId: RunId; readonly start: RunStartProvenance; readonly reason: string }
  | { readonly state: 'corrupt'; readonly runId: RunId | null; readonly directory: string; readonly reason: string }
  | { readonly state: 'unsupported-version'; readonly runId: RunId | null; readonly directory: string; readonly version: number | null };

export interface RunManifestTransaction {
  readonly start: RunStartProvenance;
  prepare(manifest: RunManifest): Promise<void>;
  commitPrepared(): Promise<string>;
  commit(manifest: RunManifest): Promise<string>;
}

/** Injectable durable writer used by alternative stores and deterministic fault tests. */
export interface RunManifestWriter {
  mkdir(path: string, options?: { readonly recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  writeExclusive(path: string, body: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
}

export interface BeginRunManifestOptions {
  readonly writer?: RunManifestWriter;
}

export async function beginRunManifest(
  runsDir: string,
  start: RunStartProvenance,
  options: BeginRunManifestOptions = {},
): Promise<RunManifestTransaction> {
  validateStart(start);
  const writer = options.writer ?? NODE_RUN_MANIFEST_WRITER;
  await writer.mkdir(runsDir, { recursive: true });
  const finalName = runDirectoryName(start.runId);
  const finalPath = join(runsDir, finalName);
  const stagingPath = join(runsDir, `.staging-${finalName}`);
  if (await writer.exists(finalPath)) throw new Error(`run history collision for ${start.runId}`);
  try { await writer.mkdir(stagingPath); }
  catch (error) { throw new Error(`run history collision for ${start.runId}`, { cause: error }); }
  await writer.writeExclusive(join(stagingPath, 'start.json'), json(start));
  let state: 'open' | 'prepared' | 'committed' = 'open';
  let preparedPath: string | undefined;
  const prepare = async (manifest: RunManifest): Promise<void> => {
    if (state !== 'open') throw new Error(`run ${start.runId} manifest transaction is ${state}`);
    validateManifest(manifest);
    if (manifest.runId !== start.runId || manifest.invocationId !== start.invocationId || manifest.startedAt !== start.startedAt) {
      throw new Error('run manifest identity/start provenance changed during execution');
    }
    const body = json(manifest);
    if (Buffer.byteLength(body, 'utf8') > MAX_MANIFEST_BYTES) {
      throw new RangeError(`run manifest exceeds the ${MAX_MANIFEST_BYTES}-byte transactional limit`);
    }
    const parsed = parseManifest(body);
    if (parsed.state !== 'complete') throw new Error(`run manifest failed round-trip validation: ${parsed.state}`);
    await writer.writeExclusive(join(stagingPath, 'manifest.json'), body);
    const digest = createHash('sha256').update(body).digest('hex');
    await writer.writeExclusive(join(stagingPath, 'COMMITTED'), commitMarker(digest));
    await writer.syncDirectory(stagingPath);
    preparedPath = join(finalPath, 'manifest.json');
    state = 'prepared';
  };
  const commitPrepared = async (): Promise<string> => {
    if (state !== 'prepared' || preparedPath === undefined) {
      throw new Error(`run ${start.runId} manifest transaction is not prepared`);
    }
    if (await writer.exists(finalPath)) throw new Error(`run history collision for ${start.runId}`);
    try { await writer.rename(stagingPath, finalPath); }
    catch (error) { throw new Error(`cannot atomically commit run ${start.runId}`, { cause: error }); }
    state = 'committed';
    await writer.syncDirectory(runsDir);
    return preparedPath;
  };
  return Object.freeze({
    start,
    prepare,
    commitPrepared,
    async commit(manifest: RunManifest): Promise<string> {
      await prepare(manifest);
      return commitPrepared();
    },
  });
}

export async function readRunHistory(runsDir: string, limit = 100): Promise<readonly RunHistoryRecord[]> {
  let entries;
  try { entries = await readdir(runsDir, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) =>
    readDirectory(runsDir, entry.name)));
  return records.sort((a, b) => startedAt(b) - startedAt(a)).slice(0, limit);
}

export async function readRunManifest(runsDir: string, runId: RunId): Promise<RunHistoryRecord> {
  parseRunId('run', runId);
  const directory = runDirectoryName(runId);
  if (await exists(join(runsDir, directory))) return readDirectory(runsDir, directory);
  const staging = `.staging-${directory}`;
  if (await exists(join(runsDir, staging))) return readDirectory(runsDir, staging);
  return { state: 'corrupt', runId, directory, reason: 'run history directory does not exist' };
}

export function parseManifest(raw: string): RunHistoryRecord {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { return { state: 'corrupt', runId: null, directory: '', reason: 'manifest is truncated or invalid JSON' }; }
  if (!object(value)) return { state: 'corrupt', runId: null, directory: '', reason: 'manifest root is not an object' };
  const version = typeof value.v === 'number' ? value.v : null;
  const runId = safeRunId(value.runId);
  if (version !== RUN_MANIFEST_VERSION) return { state: 'unsupported-version', runId, directory: '', version };
  try {
    validateManifest(value as unknown as RunManifest);
    return { state: 'complete', runId: (value as unknown as RunManifest).runId, manifest: value as unknown as RunManifest };
  } catch (error) {
    return { state: 'corrupt', runId, directory: '', reason: error instanceof Error ? error.message : String(error) };
  }
}

async function readDirectory(runsDir: string, directory: string): Promise<RunHistoryRecord> {
  const staging = directory.startsWith('.staging-');
  const encoded = staging ? directory.slice('.staging-'.length) : directory;
  const path = join(runsDir, directory);
  const start = await readJson(join(path, 'start.json'));
  const runId = object(start) ? safeRunId(start.runId) : runIdFromDirectory(encoded);
  if (staging) {
    if (object(start) && runId !== null) {
      try { validateStart(start as unknown as RunStartProvenance); return { state: 'incomplete', runId, start: start as unknown as RunStartProvenance, reason: 'transaction has no atomic commit' }; }
      catch { /* corrupt below */ }
    }
    return { state: 'corrupt', runId, directory, reason: 'staging transaction has invalid start provenance' };
  }
  const raw = await readText(join(path, 'manifest.json'));
  const marker = await readText(join(path, 'COMMITTED'));
  if (raw === null || marker === null) return { state: 'corrupt', runId, directory, reason: 'committed directory lacks manifest or marker' };
  const commit = /^termwright-run-history-v([0-9]+) sha256:([0-9a-f]{64})$/u.exec(marker.trim());
  if (commit === null) return { state: 'corrupt', runId, directory, reason: 'commit marker is invalid' };
  const commitVersion = Number(commit[1]);
  if (commitVersion !== RUN_HISTORY_COMMIT_VERSION) {
    return { state: 'unsupported-version', runId, directory, version: commitVersion };
  }
  const digest = createHash('sha256').update(raw).digest('hex');
  if (commit[2] !== digest) return { state: 'corrupt', runId, directory, reason: 'commit digest does not match manifest' };
  const parsed = parseManifest(raw);
  if (parsed.state === 'complete' && parsed.runId !== runIdFromDirectory(directory)) {
    return { state: 'corrupt', runId: parsed.runId, directory, reason: 'directory identity differs from manifest RunId' };
  }
  if (parsed.state === 'corrupt' || parsed.state === 'unsupported-version') return { ...parsed, directory };
  return parsed;
}

function validateStart(value: RunStartProvenance): void {
  parseRunId('invocation', value.invocationId); parseRunId('run', value.runId);
  finite(value.startedAt, 'startedAt');
  if (value.engine?.name !== 'vitest' || !text(value.engine.version) || !text(value.engine.certification)) throw new TypeError('invalid engine provenance');
  if (!text(value.runtime?.node) || !text(value.runtime?.platform) || !text(value.runtime?.arch)) throw new TypeError('invalid runtime provenance');
  if (!text(value.resources?.profile)) throw new TypeError('invalid resource profile');
  if (!text(value.resources?.scheduler?.pool) ||
      !positiveInteger(value.resources.scheduler.maxWorkers) ||
      typeof value.resources.scheduler.fileParallelism !== 'boolean') {
    throw new TypeError('invalid resource scheduler');
  }
  validateNumberRecord(value.resources?.capacities, 'resource capacities');
  validateNumberRecord(value.resources?.perTerminal, 'per-terminal resources');
  finite(value.timeouts?.totalRunMs, 'timeouts.totalRunMs');
  finite(value.timeouts?.finalizationReserveMs, 'timeouts.finalizationReserveMs');
  if (value.timeouts.finalizationReserveMs >= value.timeouts.totalRunMs) {
    throw new TypeError('run finalization reserve must be smaller than total timeout');
  }
  validateStringRecord(value.ci, 'CI provenance');
  if (value.git !== null) {
    if (!object(value.git) || !text(value.git.commit) || !text(value.git.message) ||
        !text(value.git.author) || !text(value.git.branch)) throw new TypeError('invalid Git provenance');
  }
}
function validateManifest(value: RunManifest): void {
  validateStart(value);
  if (value.v !== RUN_MANIFEST_VERSION) throw new TypeError('unsupported manifest version');
  finite(value.finishedAt, 'finishedAt');
  if (!['passed','failed','flaky','skipped','cancelled','crashed','infrastructure-failed','incomplete'].includes(value.status)) throw new TypeError('invalid run status');
  if (!Array.isArray(value.specs) || !Array.isArray(value.attempts) || !Array.isArray(value.events)) {
    throw new TypeError('specs/attempts/events must be arrays');
  }
  const specs = new Map<RunnerTaskId, NativeRunSpec>();
  const specIds = new Set<SpecId>();
  for (const spec of value.specs) {
    parseRunId('runner-task', spec.runnerTaskId); parseRunId('project', spec.projectId); parseRunId('spec', spec.specId);
    if (!text(spec.nativeTaskId) || !text(spec.file) || !text(spec.fullName) ||
        specs.has(spec.runnerTaskId) || specIds.has(spec.specId)) throw new TypeError('invalid or duplicate run spec');
    specs.set(spec.runnerTaskId, spec); specIds.add(spec.specId);
  }
  const attemptIds = new Set<AttemptId>();
  for (const attempt of value.attempts) {
    parseRunId('attempt', attempt.attemptId); parseRunId('execution', attempt.executionId);
    parseRunId('runner-task', attempt.runnerTaskId); parseRunId('project', attempt.projectId); parseRunId('spec', attempt.specId);
    if (!text(attempt.nativeTaskId) || !nonNegativeInteger(attempt.repeat) || !nonNegativeInteger(attempt.retry) ||
        !['passed','failed','skipped','incomplete'].includes(attempt.status)) throw new TypeError('invalid attempt');
    if (attempt.durationMs !== null) finite(attempt.durationMs, 'attempt.durationMs');
    if (attemptIds.has(attempt.attemptId)) throw new TypeError('duplicate AttemptId');
    attemptIds.add(attempt.attemptId);
    const spec = specs.get(attempt.runnerTaskId);
    if (spec === undefined || spec.projectId !== attempt.projectId || spec.specId !== attempt.specId ||
        spec.nativeTaskId !== attempt.nativeTaskId) throw new TypeError('attempt identity does not match its native spec');
  }
  for (const event of value.events) {
    const parsed = validateRunEvent(event);
    if (!parsed.ok) throw new TypeError(`invalid run journal event: ${parsed.code}: ${parsed.detail}`);
    if (parsed.value.identity.invocationId !== value.invocationId || parsed.value.identity.runId !== value.runId) {
      throw new TypeError('run journal event identity differs from manifest');
    }
  }
  const stream = new RunEventStreamValidator();
  const journalAttempts = new Map<string, { readonly start: RunEvent; finish?: RunEvent }>();
  const attemptFinishedAt = new Map<string, number>();
  const sessions = new Map<string, { readonly attemptId: string; readonly start: number; finish?: number }>();
  const steps = new Map<string, { readonly attemptId: string; readonly start: number; finish?: number }>();
  const actions = new Map<string, { readonly attemptId: string; readonly sessionId: string; finish?: number }>();
  let terminalIndex = -1;
  let terminalState: string | undefined;
  let persistenceFailureIndex = -1;
  for (const [index, event] of value.events.entries()) {
    const accepted = stream.accept(event);
    if (!accepted.ok) throw new TypeError(`invalid run journal ordering: ${accepted.code}: ${accepted.detail}`);
    if (event.type === 'run.state' && object(event.payload)) {
      const state = event.payload['state'];
      if (typeof state === 'string' && ['passed','failed','flaky','skipped','cancelled','crashed','infrastructure-failed','incomplete'].includes(state)) {
        terminalIndex = index;
        terminalState = state;
      }
    }
    if (event.type === 'run.persistence-failed') persistenceFailureIndex = index;
    if (event.type === 'attempt.started' || event.type === 'attempt.finished') {
      const attemptId = event.identity.attemptId;
      if (attemptId === undefined) throw new TypeError(`${event.type} lacks AttemptId`);
      const observed = journalAttempts.get(attemptId);
      if (event.type === 'attempt.started') {
        if (observed !== undefined) throw new TypeError(`attempt ${attemptId} starts more than once in journal`);
        journalAttempts.set(attemptId, { start: event });
      } else {
        if (observed === undefined || observed.finish !== undefined) {
          throw new TypeError(`attempt ${attemptId} finishes without one unique start`);
        }
        observed.finish = event;
        attemptFinishedAt.set(attemptId, index);
      }
    }
    const attemptId = event.identity.attemptId;
    if (event.type === 'session.started') {
      const sessionId = event.identity.sessionId;
      if (attemptId === undefined || sessionId === undefined || sessions.has(sessionId)) {
        throw new TypeError('session.started lacks a unique AttemptId/SessionId');
      }
      sessions.set(sessionId, { attemptId, start: index });
    } else if (event.type === 'session.finished') {
      const sessionId = event.identity.sessionId;
      const session = sessionId === undefined ? undefined : sessions.get(sessionId);
      if (attemptId === undefined || session === undefined || session.attemptId !== attemptId || session.finish !== undefined) {
        throw new TypeError('session.finished lacks one matching session.started');
      }
      session.finish = index;
    }
    if (event.type === 'step.started') {
      const stepId = event.identity.stepId;
      if (attemptId === undefined || stepId === undefined || steps.has(stepId)) {
        throw new TypeError('step.started lacks a unique AttemptId/StepId');
      }
      steps.set(stepId, { attemptId, start: index });
    } else if (event.type === 'step.finished') {
      const stepId = event.identity.stepId;
      const step = stepId === undefined ? undefined : steps.get(stepId);
      if (attemptId === undefined || step === undefined || step.attemptId !== attemptId || step.finish !== undefined) {
        throw new TypeError('step.finished lacks one matching step.started');
      }
      step.finish = index;
    }
    if (event.type === 'action.started' || event.type === 'action.finished') {
      const { actionId, sessionId } = event.identity;
      if (attemptId === undefined || actionId === undefined || sessionId === undefined) {
        throw new TypeError(`${event.type} lacks AttemptId/SessionId/ActionId`);
      }
      const session = sessions.get(sessionId);
      if (session === undefined || session.attemptId !== attemptId) throw new TypeError(`${event.type} references an unknown session`);
      const action = actions.get(actionId);
      if (event.type === 'action.started') {
        if (action !== undefined) throw new TypeError(`action ${actionId} starts more than once`);
        actions.set(actionId, { attemptId, sessionId });
      } else if (action === undefined) {
        // Diagnostic starts may be evicted with an explicit journal gap; the
        // authoritative terminal receipt still defines the action identity.
        actions.set(actionId, { attemptId, sessionId, finish: index });
      } else {
        if (action.attemptId !== attemptId || action.sessionId !== sessionId || action.finish !== undefined) {
          throw new TypeError(`action ${actionId} has conflicting terminal identity`);
        }
        action.finish = index;
      }
    }
  }
  if (journalAttempts.size !== value.attempts.length) throw new TypeError('attempt index differs from canonical journal');
  for (const attempt of value.attempts) validateAttemptAgainstJournal(attempt, journalAttempts.get(attempt.attemptId));
  for (const [attemptId, observed] of journalAttempts) {
    const finish = attemptFinishedAt.get(attemptId);
    if (finish === undefined) continue;
    const later = value.events.slice(finish + 1).find((event) => event.identity.attemptId === attemptId);
    if (later !== undefined) throw new TypeError(`attempt ${attemptId} emitted ${later.type} after attempt.finished`);
    const start = observed.start.identity;
    for (const event of value.events) {
      if (event.identity.attemptId !== attemptId) continue;
      if (event.identity.executionId !== start.executionId || event.identity.runnerTaskId !== start.runnerTaskId ||
          event.identity.projectId !== start.projectId || event.identity.specId !== start.specId) {
        throw new TypeError(`attempt ${attemptId} event hierarchy changed`);
      }
    }
  }
  for (const [sessionId, session] of sessions) {
    if (session.finish === undefined) throw new TypeError(`session ${sessionId} has no session.finished`);
  }
  for (const [stepId, step] of steps) {
    if (step.finish === undefined) throw new TypeError(`step ${stepId} has no step.finished`);
  }
  for (const [actionId, action] of actions) {
    if (action.finish === undefined) throw new TypeError(`action ${actionId} has no action.finished receipt`);
  }
  if (terminalState === undefined) throw new TypeError('canonical run journal has no terminal run.state');
  if (value.status === 'incomplete') {
    if (terminalState !== 'incomplete' && persistenceFailureIndex <= terminalIndex) {
      throw new TypeError('incomplete run lacks a post-terminal persistence failure');
    }
  } else if (terminalState !== value.status) {
    throw new TypeError('manifest status differs from canonical terminal run.state');
  }
}

function validateAttemptAgainstJournal(
  attempt: NativeRunAttempt,
  observed: { readonly start: RunEvent; readonly finish?: RunEvent } | undefined,
): void {
  if (observed === undefined) throw new TypeError(`attempt ${attempt.attemptId} is absent from canonical journal`);
  const start = observed.start;
  const payload = object(start.payload) ? start.payload : {};
  if (start.identity.executionId !== attempt.executionId || start.identity.runnerTaskId !== attempt.runnerTaskId ||
      start.identity.projectId !== attempt.projectId || start.identity.specId !== attempt.specId ||
      payload['nativeTaskId'] !== attempt.nativeTaskId || payload['repeat'] !== attempt.repeat || payload['retry'] !== attempt.retry) {
    throw new TypeError(`attempt ${attempt.attemptId} index identity differs from canonical journal`);
  }
  const finish = observed.finish;
  if (finish === undefined) {
    if (attempt.status !== 'incomplete' || attempt.durationMs !== null) {
      throw new TypeError(`unfinished attempt ${attempt.attemptId} is not indexed as incomplete`);
    }
    return;
  }
  const finishPayload = object(finish.payload) ? finish.payload : {};
  if (finish.identity.executionId !== attempt.executionId || finish.identity.runnerTaskId !== attempt.runnerTaskId ||
      finish.identity.projectId !== attempt.projectId || finish.identity.specId !== attempt.specId ||
      finishPayload['nativeTaskId'] !== attempt.nativeTaskId || finishPayload['repeat'] !== attempt.repeat ||
      finishPayload['retry'] !== attempt.retry || finishPayload['state'] !== attempt.status ||
      attempt.durationMs !== Math.max(0, finish.monotonicTime - start.monotonicTime)) {
    throw new TypeError(`attempt ${attempt.attemptId} terminal index differs from canonical journal`);
  }
}
/** Canonical, injective and Windows-safe directory mapping for a canonical RunId. */
export function runDirectoryName(runId: RunId): string { parseRunId('run', runId); return runId.replace(':', '_'); }
function runIdFromDirectory(value: string): RunId | null { return safeRunId(value.replace(/^run_/, 'run:')); }
function safeRunId(value: unknown): RunId | null { try { return parseRunId('run', value); } catch { return null; } }
function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
async function durableWrite(path: string, body: string): Promise<void> {
  const file = await open(path, 'wx');
  try { await file.writeFile(body, 'utf8'); await file.sync(); } finally { await file.close(); }
}
async function readText(path: string): Promise<string | null> { try { const s = await stat(path); if (s.size > MAX_MANIFEST_BYTES) return null; return await readFile(path, 'utf8'); } catch { return null; } }
async function readJson(path: string): Promise<unknown> { const raw = await readText(path); if (raw === null) return null; try { return JSON.parse(raw); } catch { return null; } }
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
export const NODE_RUN_MANIFEST_WRITER = Object.freeze<RunManifestWriter>({
  async mkdir(path, options) { await mkdir(path, options); },
  exists,
  writeExclusive: durableWrite,
  async syncDirectory(path) {
    let directory;
    try {
      directory = await open(path, 'r');
      await directory.sync();
    } catch (error) {
      // Windows does not expose directory fsync through Node. Its same-volume
      // MoveFileEx-backed rename remains atomic; do not pretend this is a file
      // write error when the platform rejects opening a directory handle.
      if (process.platform !== 'win32') throw error;
    } finally {
      await directory?.close();
    }
  },
  async rename(source, destination) { await rename(source, destination); },
});
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function finite(value: unknown, name: string): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`${name} is invalid`); }
function nonNegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function positiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function validateNumberRecord(value: unknown, name: string): void {
  if (!object(value) || Object.keys(value).length > 256) throw new TypeError(`invalid ${name}`);
  for (const [key, entry] of Object.entries(value)) if (!text(key) || !nonNegativeInteger(entry)) throw new TypeError(`invalid ${name}`);
}
function validateStringRecord(value: unknown, name: string): void {
  if (!object(value) || Object.keys(value).length > 256) throw new TypeError(`invalid ${name}`);
  for (const [key, entry] of Object.entries(value)) if (!text(key) || !text(entry) || entry.length > 16_384) throw new TypeError(`invalid ${name}`);
}
function startedAt(record: RunHistoryRecord): number { return record.state === 'complete' ? record.manifest.startedAt : record.state === 'incomplete' ? record.start.startedAt : 0; }
function commitMarker(digest: string): string {
  return `termwright-run-history-v${RUN_HISTORY_COMMIT_VERSION} sha256:${digest}\n`;
}
