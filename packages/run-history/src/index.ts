import { createHash } from 'node:crypto';
import { appendFile, mkdir, open, readFile, readdir, rename, stat } from 'node:fs/promises';
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

export const RUN_MANIFEST_VERSION = 7 as const;
export const RUN_HISTORY_COMMIT_VERSION = 2 as const;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_RUN_EVENT_STREAM_BYTES = 512 * 1024 * 1024;
export const MAX_RUN_EVENT_STREAM_EVENTS = 1_000_000;

export type NativeRunStatus =
  | 'passed'
  | 'passed-with-skips'
  | 'failed'
  | 'flaky'
  | 'skipped'
  | 'cancelled'
  | 'crashed'
  | 'infrastructure-failed'
  | 'incomplete';
export interface RunStartProvenance {
  readonly invocationId: InvocationId;
  readonly runId: RunId;
  readonly startedAt: number;
  readonly engine: {
    readonly name: 'vitest';
    readonly version: string;
    readonly certification: string;
  };
  readonly runtime: { readonly node: string; readonly platform: string; readonly arch: string };
  readonly resources: {
    readonly profile: string;
    readonly scheduler: {
      readonly pool: string;
      readonly maxWorkers: number;
      readonly fileParallelism: boolean;
      readonly decisions?: readonly string[];
    };
    readonly capacities: Readonly<Record<string, number>>;
    readonly perAttempt: Readonly<Record<string, number>>;
    readonly perTerminal: Readonly<Record<string, number>>;
    readonly hostCapacity?: {
      readonly availableCpu: number;
      readonly memoryLimitBytes: number;
      readonly memoryReserveBytes: number;
      readonly memoryBudgetBytes: number;
      readonly tempDiskAvailableBytes: number | 'unavailable';
      readonly tempDiskBudgetBytes: number | 'unavailable';
      readonly sources: Readonly<Record<string, string>>;
    };
  };
  readonly timeouts: {
    readonly totalRunMs: number;
    readonly finalizationReserveMs: number;
  };
  readonly ci: Readonly<Record<string, string>>;
  readonly git: null | {
    readonly commit: string;
    readonly message: string;
    readonly author: string;
    readonly branch: string;
  };
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
  /** Host-monotonic offset at which the authoritative attempt start was accepted. */
  readonly startedAfterRunMs: number;
  /** Host-monotonic offset at which the authoritative attempt finish was accepted. */
  readonly finishedAfterRunMs: number | null;
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
export type UnavailableRunMetric = 'unavailable';
export interface RunResourceTelemetry {
  readonly coordinatorCpuUserMicros: number;
  readonly coordinatorCpuSystemMicros: number;
  readonly coordinatorRssStartBytes: number;
  readonly coordinatorRssEndBytes: number;
  /** Maximum of bounded periodic samples plus exact start/end samples. */
  readonly coordinatorPeakSampledRssBytes: number;
  readonly workerPeakRssBytes: number | UnavailableRunMetric;
  readonly workerCpuUserMicros: number | UnavailableRunMetric;
  readonly workerCpuSystemMicros: number | UnavailableRunMetric;
  readonly ownedProcessPeakRssBytes: number | UnavailableRunMetric;
  readonly ownedProcessCountPeak: number | UnavailableRunMetric;
  readonly ptySlotsPeak: number;
  readonly terminalOutputBytes: number | UnavailableRunMetric;
  readonly semanticBytes: number | UnavailableRunMetric;
  readonly semanticFullCount: number | UnavailableRunMetric;
  readonly semanticDeltaCount: number | UnavailableRunMetric;
  readonly journalAcceptedEvents: number;
  readonly journalAcceptedBytes: number;
  readonly journalSinkCalls: number;
  readonly journalPeakBacklogEvents: number;
  readonly journalPeakBacklogBytes: number;
  readonly traceBytes: number | UnavailableRunMetric;
  readonly tempDiskPeakBytes: number | UnavailableRunMetric;
  readonly finalArtifactBytes: number | UnavailableRunMetric;
}
export interface RunManifest extends RunStartProvenance {
  readonly v: typeof RUN_MANIFEST_VERSION;
  readonly finishedAt: number;
  /** Host-monotonic elapsed time immediately before durable history preparation. */
  readonly durationMs: number;
  readonly status: NativeRunStatus;
  readonly specs: readonly NativeRunSpec[];
  readonly attempts: readonly NativeRunAttempt[];
  readonly telemetry: RunResourceTelemetry;
  readonly eventStream: {
    readonly file: 'events.ndjson';
    readonly count: number;
    readonly bytes: number;
    readonly sha256: string;
  };
  /** Reader facade over the independently checksummed canonical event stream. */
  readonly events: readonly RunEvent[];
}
export type RunManifestSummary = Omit<RunManifest, 'events' | 'eventStream'>;
export type RunHistoryRecord =
  | { readonly state: 'complete'; readonly runId: RunId; readonly manifest: RunManifest }
  | {
      readonly state: 'incomplete';
      readonly runId: RunId;
      readonly start: RunStartProvenance;
      readonly reason: string;
    }
  | {
      readonly state: 'corrupt';
      readonly runId: RunId | null;
      readonly directory: string;
      readonly reason: string;
    }
  | {
      readonly state: 'unsupported-version';
      readonly runId: RunId | null;
      readonly directory: string;
      readonly version: number | null;
    };

export interface RunManifestTransaction {
  readonly start: RunStartProvenance;
  appendEvents(events: readonly RunEvent[]): Promise<void>;
  prepare(manifest: RunManifestSummary): Promise<void>;
  commitPrepared(): Promise<string>;
  commit(manifest: RunManifestSummary): Promise<string>;
}

/** Injectable durable writer used by alternative stores and deterministic fault tests. */
export interface RunManifestWriter {
  mkdir(path: string, options?: { readonly recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  writeExclusive(path: string, body: string): Promise<void>;
  append(path: string, body: string): Promise<void>;
  syncFile(path: string): Promise<void>;
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
  try {
    await writer.mkdir(stagingPath);
  } catch (error) {
    throw new Error(`run history collision for ${start.runId}`, { cause: error });
  }
  await writer.writeExclusive(join(stagingPath, 'start.json'), json(start));
  const eventPath = join(stagingPath, 'events.ndjson');
  await writer.writeExclusive(eventPath, '');
  const eventHash = createHash('sha256');
  const eventOrder = new RunEventStreamValidator();
  let eventCount = 0;
  let eventBytes = 0;
  let state: 'open' | 'prepared' | 'committed' | 'failed' = 'open';
  let preparedPath: string | undefined;
  const appendEvents = async (events: readonly RunEvent[]): Promise<void> => {
    if (state !== 'open') throw new Error(`run ${start.runId} manifest transaction is ${state}`);
    if (events.length === 0) return;
    const lines: string[] = [];
    for (const event of events) {
      const parsed = validateRunEvent(event);
      if (!parsed.ok)
        throw new TypeError(`invalid run journal event: ${parsed.code}: ${parsed.detail}`);
      if (
        event.identity.invocationId !== start.invocationId ||
        event.identity.runId !== start.runId
      ) {
        throw new TypeError('run journal event identity differs from transaction');
      }
      lines.push(`${JSON.stringify(event)}\n`);
    }
    const body = lines.join('');
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    if (
      eventCount + events.length > MAX_RUN_EVENT_STREAM_EVENTS ||
      eventBytes + bodyBytes > MAX_RUN_EVENT_STREAM_BYTES
    ) {
      throw new RangeError('run event stream exceeds its configured count or byte capacity');
    }
    for (const event of events) {
      const accepted = eventOrder.accept(event);
      if (!accepted.ok) {
        state = 'failed';
        throw new TypeError(`invalid run journal ordering: ${accepted.code}: ${accepted.detail}`);
      }
    }
    try {
      await writer.append(eventPath, body);
    } catch (error) {
      state = 'failed';
      throw error;
    }
    eventHash.update(body);
    eventCount += events.length;
    eventBytes += bodyBytes;
  };
  const prepare = async (summary: RunManifestSummary): Promise<void> => {
    if (state !== 'open') throw new Error(`run ${start.runId} manifest transaction is ${state}`);
    const manifest: RunManifest = {
      ...summary,
      eventStream: {
        file: 'events.ndjson',
        count: eventCount,
        bytes: eventBytes,
        sha256: eventHash.copy().digest('hex'),
      },
      events: [],
    };
    validateManifestSummary(summary);
    if (
      manifest.runId !== start.runId ||
      manifest.invocationId !== start.invocationId ||
      manifest.startedAt !== start.startedAt
    ) {
      throw new Error('run manifest identity/start provenance changed during execution');
    }
    const { events: _events, ...persistedManifest } = manifest;
    const body = json(persistedManifest);
    if (Buffer.byteLength(body, 'utf8') > MAX_MANIFEST_BYTES) {
      throw new RangeError(
        `run manifest exceeds the ${MAX_MANIFEST_BYTES}-byte transactional limit`,
      );
    }
    const roundTrip = parseJsonObject(body);
    if (roundTrip === null) throw new Error('run manifest failed JSON round-trip validation');
    validateManifestSummary(roundTrip as unknown as RunManifestSummary);
    await writer.syncFile(eventPath);
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
    try {
      await writer.rename(stagingPath, finalPath);
    } catch (error) {
      throw new Error(`cannot atomically commit run ${start.runId}`, { cause: error });
    }
    state = 'committed';
    await writer.syncDirectory(runsDir);
    return preparedPath;
  };
  return Object.freeze({
    start,
    appendEvents,
    prepare,
    commitPrepared,
    async commit(manifest: RunManifestSummary): Promise<string> {
      await prepare(manifest);
      return commitPrepared();
    },
  });
}

export async function readRunHistory(
  runsDir: string,
  limit = 100,
): Promise<readonly RunHistoryRecord[]> {
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readDirectory(runsDir, entry.name)),
  );
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

export function parseManifest(raw: string, streamedEvents?: readonly RunEvent[]): RunHistoryRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {
      state: 'corrupt',
      runId: null,
      directory: '',
      reason: 'manifest is truncated or invalid JSON',
    };
  }
  if (!object(value))
    return {
      state: 'corrupt',
      runId: null,
      directory: '',
      reason: 'manifest root is not an object',
    };
  const version = typeof value.v === 'number' ? value.v : null;
  const runId = safeRunId(value.runId);
  if (version !== RUN_MANIFEST_VERSION)
    return { state: 'unsupported-version', runId, directory: '', version };
  try {
    const manifest = {
      ...value,
      events: streamedEvents ?? value['events'],
    } as unknown as RunManifest;
    validateManifest(manifest);
    return {
      state: 'complete',
      runId: manifest.runId,
      manifest,
    };
  } catch (error) {
    return {
      state: 'corrupt',
      runId,
      directory: '',
      reason: error instanceof Error ? error.message : String(error),
    };
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
      try {
        validateStart(start as unknown as RunStartProvenance);
        return {
          state: 'incomplete',
          runId,
          start: start as unknown as RunStartProvenance,
          reason: 'transaction has no atomic commit',
        };
      } catch {
        /* corrupt below */
      }
    }
    return {
      state: 'corrupt',
      runId,
      directory,
      reason: 'staging transaction has invalid start provenance',
    };
  }
  const raw = await readText(join(path, 'manifest.json'));
  const marker = await readText(join(path, 'COMMITTED'));
  if (raw === null || marker === null)
    return {
      state: 'corrupt',
      runId,
      directory,
      reason: 'committed directory lacks manifest or marker',
    };
  const commit = /^termwright-run-history-v([0-9]+) sha256:([0-9a-f]{64})$/u.exec(marker.trim());
  if (commit === null)
    return { state: 'corrupt', runId, directory, reason: 'commit marker is invalid' };
  const commitVersion = Number(commit[1]);
  if (commitVersion !== RUN_HISTORY_COMMIT_VERSION) {
    return { state: 'unsupported-version', runId, directory, version: commitVersion };
  }
  const digest = createHash('sha256').update(raw).digest('hex');
  if (commit[2] !== digest)
    return { state: 'corrupt', runId, directory, reason: 'commit digest does not match manifest' };
  const header = parseJsonObject(raw);
  if (header === null) {
    return { state: 'corrupt', runId, directory, reason: 'manifest is truncated or invalid JSON' };
  }
  const manifestVersion = typeof header['v'] !== 'number' ? null : header['v'];
  if (manifestVersion !== RUN_MANIFEST_VERSION) {
    return { state: 'unsupported-version', runId, directory, version: manifestVersion };
  }
  const eventStream =
    object(header) && object(header['eventStream']) ? header['eventStream'] : null;
  if (
    eventStream === null ||
    eventStream['file'] !== 'events.ndjson' ||
    !nonNegativeInteger(eventStream['count']) ||
    !nonNegativeInteger(eventStream['bytes']) ||
    eventStream['count'] > MAX_RUN_EVENT_STREAM_EVENTS ||
    eventStream['bytes'] > MAX_RUN_EVENT_STREAM_BYTES ||
    !/^[0-9a-f]{64}$/u.test(String(eventStream['sha256']))
  ) {
    return { state: 'corrupt', runId, directory, reason: 'manifest event stream is invalid' };
  }
  const eventRaw = await readEventText(join(path, 'events.ndjson'), eventStream['bytes']);
  if (eventRaw === null) {
    return { state: 'corrupt', runId, directory, reason: 'event stream is missing or truncated' };
  }
  if (createHash('sha256').update(eventRaw).digest('hex') !== eventStream['sha256']) {
    return {
      state: 'corrupt',
      runId,
      directory,
      reason: 'event stream digest does not match manifest',
    };
  }
  const events = parseEventLines(eventRaw);
  if (events === null) {
    return { state: 'corrupt', runId, directory, reason: 'event stream contains invalid NDJSON' };
  }
  const parsed = parseManifest(raw, events);
  if (parsed.state === 'complete' && parsed.runId !== runIdFromDirectory(directory)) {
    return {
      state: 'corrupt',
      runId: parsed.runId,
      directory,
      reason: 'directory identity differs from manifest RunId',
    };
  }
  if (parsed.state === 'corrupt' || parsed.state === 'unsupported-version')
    return { ...parsed, directory };
  return parsed;
}

function validateStart(value: RunStartProvenance): void {
  parseRunId('invocation', value.invocationId);
  parseRunId('run', value.runId);
  finite(value.startedAt, 'startedAt');
  if (
    value.engine?.name !== 'vitest' ||
    !text(value.engine.version) ||
    !text(value.engine.certification)
  )
    throw new TypeError('invalid engine provenance');
  if (!text(value.runtime?.node) || !text(value.runtime?.platform) || !text(value.runtime?.arch))
    throw new TypeError('invalid runtime provenance');
  if (!text(value.resources?.profile)) throw new TypeError('invalid resource profile');
  if (
    !text(value.resources?.scheduler?.pool) ||
    !positiveInteger(value.resources.scheduler.maxWorkers) ||
    typeof value.resources.scheduler.fileParallelism !== 'boolean'
  ) {
    throw new TypeError('invalid resource scheduler');
  }
  if (
    value.resources.scheduler.decisions !== undefined &&
    (!Array.isArray(value.resources.scheduler.decisions) ||
      !value.resources.scheduler.decisions.every((decision) => text(decision)))
  ) {
    throw new TypeError('invalid resource scheduler decisions');
  }
  validateNumberRecord(value.resources?.capacities, 'resource capacities');
  validateNumberRecord(value.resources?.perAttempt, 'per-attempt resources');
  validateNumberRecord(value.resources?.perTerminal, 'per-terminal resources');
  if (value.resources.hostCapacity !== undefined)
    validateHostCapacity(value.resources.hostCapacity);
  finite(value.timeouts?.totalRunMs, 'timeouts.totalRunMs');
  finite(value.timeouts?.finalizationReserveMs, 'timeouts.finalizationReserveMs');
  if (value.timeouts.finalizationReserveMs >= value.timeouts.totalRunMs) {
    throw new TypeError('run finalization reserve must be smaller than total timeout');
  }
  validateStringRecord(value.ci, 'CI provenance');
  if (value.git !== null) {
    if (
      !object(value.git) ||
      !text(value.git.commit) ||
      !text(value.git.message) ||
      !text(value.git.author) ||
      !text(value.git.branch)
    )
      throw new TypeError('invalid Git provenance');
  }
}

function validateHostCapacity(
  value: NonNullable<RunStartProvenance['resources']['hostCapacity']>,
): void {
  finite(value.availableCpu, 'hostCapacity.availableCpu');
  finite(value.memoryLimitBytes, 'hostCapacity.memoryLimitBytes');
  finite(value.memoryReserveBytes, 'hostCapacity.memoryReserveBytes');
  finite(value.memoryBudgetBytes, 'hostCapacity.memoryBudgetBytes');
  for (const [name, amount] of [
    ['tempDiskAvailableBytes', value.tempDiskAvailableBytes],
    ['tempDiskBudgetBytes', value.tempDiskBudgetBytes],
  ] as const) {
    if (amount !== 'unavailable') finite(amount, `hostCapacity.${name}`);
  }
  validateStringRecord(value.sources, 'hostCapacity.sources');
}
function validateManifest(value: RunManifest): void {
  validateManifestSummary(value);
  if (
    !object(value.eventStream) ||
    value.eventStream.file !== 'events.ndjson' ||
    !nonNegativeInteger(value.eventStream.count) ||
    !nonNegativeInteger(value.eventStream.bytes) ||
    value.eventStream.count > MAX_RUN_EVENT_STREAM_EVENTS ||
    value.eventStream.bytes > MAX_RUN_EVENT_STREAM_BYTES ||
    !/^[0-9a-f]{64}$/u.test(value.eventStream.sha256) ||
    value.eventStream.count !== value.events.length
  ) {
    throw new TypeError('invalid run event stream metadata');
  }
  validateManifestEvidence(value);
}

function validateManifestSummary(value: RunManifestSummary): void {
  validateStart(value);
  if (value.v !== RUN_MANIFEST_VERSION) throw new TypeError('unsupported manifest version');
  finite(value.finishedAt, 'finishedAt');
  finite(value.durationMs, 'durationMs');
  if (
    ![
      'passed',
      'passed-with-skips',
      'failed',
      'flaky',
      'skipped',
      'cancelled',
      'crashed',
      'infrastructure-failed',
      'incomplete',
    ].includes(value.status)
  )
    throw new TypeError('invalid run status');
  if (!Array.isArray(value.specs) || !Array.isArray(value.attempts)) {
    throw new TypeError('specs/attempts must be arrays');
  }
  validateRunTelemetry(value.telemetry);
  const specs = new Map<RunnerTaskId, NativeRunSpec>();
  const specIds = new Set<SpecId>();
  for (const spec of value.specs) {
    parseRunId('runner-task', spec.runnerTaskId);
    parseRunId('project', spec.projectId);
    parseRunId('spec', spec.specId);
    if (
      !text(spec.nativeTaskId) ||
      !text(spec.file) ||
      !text(spec.fullName) ||
      specs.has(spec.runnerTaskId) ||
      specIds.has(spec.specId)
    )
      throw new TypeError('invalid or duplicate run spec');
    specs.set(spec.runnerTaskId, spec);
    specIds.add(spec.specId);
  }
  const attemptIds = new Set<AttemptId>();
  for (const attempt of value.attempts) {
    parseRunId('attempt', attempt.attemptId);
    parseRunId('execution', attempt.executionId);
    parseRunId('runner-task', attempt.runnerTaskId);
    parseRunId('project', attempt.projectId);
    parseRunId('spec', attempt.specId);
    if (
      !text(attempt.nativeTaskId) ||
      !nonNegativeInteger(attempt.repeat) ||
      !nonNegativeInteger(attempt.retry) ||
      !['passed', 'failed', 'skipped', 'incomplete'].includes(attempt.status)
    )
      throw new TypeError('invalid attempt');
    finite(attempt.startedAfterRunMs, 'attempt.startedAfterRunMs');
    if (attempt.startedAfterRunMs > value.durationMs) {
      throw new TypeError('attempt.startedAfterRunMs exceeds run durationMs');
    }
    if (attempt.finishedAfterRunMs !== null) {
      finite(attempt.finishedAfterRunMs, 'attempt.finishedAfterRunMs');
      if (attempt.finishedAfterRunMs < attempt.startedAfterRunMs) {
        throw new TypeError('attempt.finishedAfterRunMs precedes attempt.startedAfterRunMs');
      }
      if (attempt.finishedAfterRunMs > value.durationMs) {
        throw new TypeError('attempt.finishedAfterRunMs exceeds run durationMs');
      }
    }
    if (attempt.durationMs !== null) finite(attempt.durationMs, 'attempt.durationMs');
    if (attemptIds.has(attempt.attemptId)) throw new TypeError('duplicate AttemptId');
    attemptIds.add(attempt.attemptId);
    const spec = specs.get(attempt.runnerTaskId);
    if (
      spec === undefined ||
      spec.projectId !== attempt.projectId ||
      spec.specId !== attempt.specId ||
      spec.nativeTaskId !== attempt.nativeTaskId
    )
      throw new TypeError('attempt identity does not match its native spec');
  }
}

function validateManifestEvidence(value: RunManifest): void {
  const specs = new Map(value.specs.map((spec) => [spec.runnerTaskId, spec]));
  for (const event of value.events) {
    const parsed = validateRunEvent(event);
    if (!parsed.ok)
      throw new TypeError(`invalid run journal event: ${parsed.code}: ${parsed.detail}`);
    if (
      parsed.value.identity.invocationId !== value.invocationId ||
      parsed.value.identity.runId !== value.runId
    ) {
      throw new TypeError('run journal event identity differs from manifest');
    }
  }
  const stream = new RunEventStreamValidator();
  const journalAttempts = new Map<string, { readonly start: RunEvent; finish?: RunEvent }>();
  const attemptHierarchies = new Map<
    string,
    {
      readonly executionId: RunEvent['identity']['executionId'] | undefined;
      readonly runnerTaskId: RunEvent['identity']['runnerTaskId'] | undefined;
      readonly projectId: RunEvent['identity']['projectId'] | undefined;
      readonly specId: RunEvent['identity']['specId'] | undefined;
    }
  >();
  const finishedAttempts = new Set<string>();
  const sessions = new Map<
    string,
    { readonly attemptId: string; readonly start: number; finish?: number }
  >();
  const traceResources = new Map<string, TraceResourceEvidence>();
  const steps = new Map<
    string,
    { readonly attemptId: string; readonly start: number; finish?: number }
  >();
  const actions = new Map<
    string,
    { readonly attemptId: string; readonly sessionId: string; finish?: number }
  >();
  let terminalIndex = -1;
  let terminalState: string | undefined;
  let persistenceFailureIndex = -1;
  let skipDeclarations = 0;
  let skippedTests = 0;
  let skipPolicyIssues = 0;
  let skipPolicy: Readonly<Record<string, unknown>> | undefined;
  for (const [index, event] of value.events.entries()) {
    const accepted = stream.accept(event);
    if (!accepted.ok)
      throw new TypeError(`invalid run journal ordering: ${accepted.code}: ${accepted.detail}`);
    const attemptId = event.identity.attemptId;
    if (attemptId !== undefined) {
      if (finishedAttempts.has(attemptId)) {
        throw new TypeError(`attempt ${attemptId} emitted ${event.type} after attempt.finished`);
      }
      const hierarchy = attemptHierarchies.get(attemptId);
      if (hierarchy === undefined) {
        attemptHierarchies.set(attemptId, {
          executionId: event.identity.executionId,
          runnerTaskId: event.identity.runnerTaskId,
          projectId: event.identity.projectId,
          specId: event.identity.specId,
        });
      } else if (
        event.identity.executionId !== hierarchy.executionId ||
        event.identity.runnerTaskId !== hierarchy.runnerTaskId ||
        event.identity.projectId !== hierarchy.projectId ||
        event.identity.specId !== hierarchy.specId
      ) {
        throw new TypeError(`attempt ${attemptId} event hierarchy changed`);
      }
    }
    if (event.type === 'run.state' && object(event.payload)) {
      const state = event.payload['state'];
      if (
        typeof state === 'string' &&
        [
          'passed',
          'passed-with-skips',
          'failed',
          'flaky',
          'skipped',
          'cancelled',
          'crashed',
          'infrastructure-failed',
          'incomplete',
        ].includes(state)
      ) {
        terminalIndex = index;
        terminalState = state;
      }
    }
    if (event.type === 'run.persistence-failed') persistenceFailureIndex = index;
    if (event.type === 'run.skip-declaration') {
      const payload = object(event.payload) ? event.payload : {};
      if (
        !text(payload['id']) ||
        !text(payload['file']) ||
        !text(payload['fullName']) ||
        (payload['suite'] !== undefined && !text(payload['suite'])) ||
        typeof payload['required'] !== 'boolean'
      ) {
        throw new TypeError('run.skip-declaration has invalid exact policy evidence');
      }
      skipDeclarations += 1;
    } else if (event.type === 'test.skipped') {
      const task = event.identity.runnerTaskId;
      const spec = task === undefined ? undefined : specs.get(task);
      const payload = object(event.payload) ? event.payload : {};
      if (
        spec === undefined ||
        event.identity.projectId !== spec.projectId ||
        event.identity.specId !== spec.specId ||
        payload['nativeTaskId'] !== spec.nativeTaskId ||
        payload['file'] !== spec.file ||
        payload['fullName'] !== spec.fullName
      ) {
        throw new TypeError('test.skipped identity differs from its native spec');
      }
      skippedTests += 1;
    } else if (event.type === 'run.skip-policy-issue') {
      const payload = object(event.payload) ? event.payload : {};
      if (!text(payload['detail']))
        throw new TypeError('run.skip-policy-issue lacks bounded detail');
      skipPolicyIssues += 1;
    } else if (event.type === 'run.skip-policy') {
      if (skipPolicy !== undefined || !object(event.payload))
        throw new TypeError('run.skip-policy must occur exactly once');
      skipPolicy = event.payload;
    }
    if (event.type === 'attempt.started' || event.type === 'attempt.finished') {
      if (attemptId === undefined) throw new TypeError(`${event.type} lacks AttemptId`);
      const observed = journalAttempts.get(attemptId);
      if (event.type === 'attempt.started') {
        if (observed !== undefined)
          throw new TypeError(`attempt ${attemptId} starts more than once in journal`);
        journalAttempts.set(attemptId, { start: event });
      } else {
        if (observed === undefined || observed.finish !== undefined) {
          throw new TypeError(`attempt ${attemptId} finishes without one unique start`);
        }
        observed.finish = event;
        finishedAttempts.add(attemptId);
      }
    }
    if (event.type === 'session.started') {
      const sessionId = event.identity.sessionId;
      if (attemptId === undefined || sessionId === undefined || sessions.has(sessionId)) {
        throw new TypeError('session.started lacks a unique AttemptId/SessionId');
      }
      sessions.set(sessionId, { attemptId, start: index });
    } else if (event.type === 'session.finished') {
      const sessionId = event.identity.sessionId;
      const session = sessionId === undefined ? undefined : sessions.get(sessionId);
      if (
        attemptId === undefined ||
        session === undefined ||
        session.attemptId !== attemptId ||
        session.finish !== undefined
      ) {
        throw new TypeError('session.finished lacks one matching session.started');
      }
      session.finish = index;
    }
    if (event.type === 'trace.resource') {
      const sessionId = event.identity.sessionId;
      const session = sessionId === undefined ? undefined : sessions.get(sessionId);
      if (
        attemptId === undefined ||
        sessionId === undefined ||
        session === undefined ||
        session.attemptId !== attemptId ||
        traceResources.has(sessionId)
      ) {
        throw new TypeError('trace.resource lacks one unique matching session');
      }
      traceResources.set(sessionId, traceResourceEvidence(event.payload));
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
      if (
        attemptId === undefined ||
        step === undefined ||
        step.attemptId !== attemptId ||
        step.finish !== undefined
      ) {
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
      if (session === undefined || session.attemptId !== attemptId)
        throw new TypeError(`${event.type} references an unknown session`);
      const action = actions.get(actionId);
      if (event.type === 'action.started') {
        if (action !== undefined) throw new TypeError(`action ${actionId} starts more than once`);
        actions.set(actionId, { attemptId, sessionId });
      } else if (action === undefined) {
        // Diagnostic starts may be evicted with an explicit journal gap; the
        // authoritative terminal receipt still defines the action identity.
        actions.set(actionId, { attemptId, sessionId, finish: index });
      } else {
        if (
          action.attemptId !== attemptId ||
          action.sessionId !== sessionId ||
          action.finish !== undefined
        ) {
          throw new TypeError(`action ${actionId} has conflicting terminal identity`);
        }
        action.finish = index;
      }
    }
  }
  if (journalAttempts.size !== value.attempts.length)
    throw new TypeError('attempt index differs from canonical journal');
  for (const attempt of value.attempts)
    validateAttemptAgainstJournal(attempt, journalAttempts.get(attempt.attemptId));
  const workerSamples = [...journalAttempts.values()]
    .map((attempt) =>
      attempt.finish === undefined ? undefined : workerResources(attempt.finish.payload),
    )
    .filter((sample): sample is AttemptWorkerResources => sample !== undefined);
  const expectedWorkerPeak =
    workerSamples.length === 0
      ? 'unavailable'
      : Math.max(...workerSamples.map((sample) => sample.peakSampledRssBytes));
  const expectedWorkerUser =
    workerSamples.length === 0
      ? 'unavailable'
      : workerSamples.reduce((total, sample) => total + sample.cpuUserMicros, 0);
  const expectedWorkerSystem =
    workerSamples.length === 0
      ? 'unavailable'
      : workerSamples.reduce((total, sample) => total + sample.cpuSystemMicros, 0);
  if (
    value.telemetry.workerPeakRssBytes !== expectedWorkerPeak ||
    value.telemetry.workerCpuUserMicros !== expectedWorkerUser ||
    value.telemetry.workerCpuSystemMicros !== expectedWorkerSystem
  ) {
    throw new TypeError('run worker telemetry differs from canonical attempt evidence');
  }
  const expectedTrace = aggregateTraceEvidence(sessions.size, [...traceResources.values()]);
  if (
    value.telemetry.terminalOutputBytes !==
      (expectedTrace.complete ? expectedTrace.terminalOutputBytes : 'unavailable') ||
    value.telemetry.semanticBytes !==
      (expectedTrace.complete ? expectedTrace.semanticBytes : 'unavailable') ||
    value.telemetry.semanticFullCount !==
      (expectedTrace.complete ? expectedTrace.semanticFullCount : 'unavailable') ||
    value.telemetry.semanticDeltaCount !==
      (expectedTrace.complete ? expectedTrace.semanticDeltaCount : 'unavailable') ||
    value.telemetry.traceBytes !==
      (expectedTrace.complete ? expectedTrace.traceBytes : 'unavailable') ||
    value.telemetry.finalArtifactBytes !==
      (expectedTrace.complete ? expectedTrace.finalArtifactBytes : 'unavailable')
  ) {
    throw new TypeError('run trace telemetry differs from canonical session evidence');
  }
  for (const [sessionId, session] of sessions) {
    if (session.finish === undefined)
      throw new TypeError(`session ${sessionId} has no session.finished`);
  }
  for (const [stepId, step] of steps) {
    if (step.finish === undefined) throw new TypeError(`step ${stepId} has no step.finished`);
  }
  for (const [actionId, action] of actions) {
    if (action.finish === undefined)
      throw new TypeError(`action ${actionId} has no action.finished receipt`);
  }
  if (terminalState === undefined)
    throw new TypeError('canonical run journal has no terminal run.state');
  if (
    skipPolicy === undefined ||
    skipPolicy['status'] !== (skipPolicyIssues === 0 ? 'matched' : 'mismatch') ||
    skipPolicy['declarations'] !== skipDeclarations ||
    skipPolicy['observed'] !== skippedTests ||
    skipPolicy['issues'] !== skipPolicyIssues
  ) {
    throw new TypeError('run lacks complete canonical skip-policy evidence');
  }
  if (
    (value.status === 'passed-with-skips' && skippedTests === 0) ||
    (value.status === 'passed' && skippedTests > 0)
  ) {
    throw new TypeError('run verdict differs from its observed skip evidence');
  }
  if (value.status === 'incomplete') {
    if (terminalState !== 'incomplete' && persistenceFailureIndex <= terminalIndex) {
      throw new TypeError('incomplete run lacks a post-terminal persistence failure');
    }
  } else if (terminalState !== value.status) {
    throw new TypeError('manifest status differs from canonical terminal run.state');
  }
}

interface AttemptWorkerResources {
  readonly cpuUserMicros: number;
  readonly cpuSystemMicros: number;
  readonly peakSampledRssBytes: number;
}

interface TraceResourceEvidence {
  readonly terminalOutputBytes: number;
  readonly semanticBytes: number;
  readonly semanticFullCount: number;
  readonly semanticDeltaCount: number;
  readonly traceBytes: number;
  readonly finalArtifactBytes: number;
}

function traceResourceEvidence(payload: unknown): TraceResourceEvidence {
  const record = object(payload) ? payload : {};
  const names = [
    'terminalOutputBytes',
    'semanticBytes',
    'semanticFullCount',
    'semanticDeltaCount',
    'traceBytes',
    'finalArtifactBytes',
  ] as const;
  if (
    Object.keys(record).length !== names.length ||
    names.some((name) => !nonNegativeInteger(record[name]))
  ) {
    throw new TypeError('trace.resource lacks valid exact counters');
  }
  return Object.freeze(
    Object.fromEntries(names.map((name) => [name, record[name]])),
  ) as unknown as TraceResourceEvidence;
}

function aggregateTraceEvidence(
  sessionCount: number,
  records: readonly TraceResourceEvidence[],
): TraceResourceEvidence & { readonly complete: boolean } {
  const sum = (name: keyof TraceResourceEvidence): number => {
    const total = records.reduce((value, record) => value + record[name], 0);
    if (!Number.isSafeInteger(total))
      throw new TypeError(`aggregate trace counter ${name} overflowed`);
    return total;
  };
  return Object.freeze({
    complete: records.length === sessionCount,
    terminalOutputBytes: sum('terminalOutputBytes'),
    semanticBytes: sum('semanticBytes'),
    semanticFullCount: sum('semanticFullCount'),
    semanticDeltaCount: sum('semanticDeltaCount'),
    traceBytes: sum('traceBytes'),
    finalArtifactBytes: sum('finalArtifactBytes'),
  });
}

function workerResources(payload: unknown): AttemptWorkerResources {
  const terminal = object(payload) ? payload : {};
  const worker = object(terminal['worker']) ? terminal['worker'] : {};
  if (
    worker['capability'] !== 'worker-process' ||
    !nonNegativeInteger(worker['cpuUserMicros']) ||
    !nonNegativeInteger(worker['cpuSystemMicros']) ||
    !nonNegativeInteger(worker['peakSampledRssBytes'])
  ) {
    throw new TypeError('attempt.finished lacks valid worker-process telemetry');
  }
  return {
    cpuUserMicros: worker['cpuUserMicros'],
    cpuSystemMicros: worker['cpuSystemMicros'],
    peakSampledRssBytes: worker['peakSampledRssBytes'],
  };
}

function validateRunTelemetry(value: RunResourceTelemetry): void {
  if (!object(value)) throw new TypeError('invalid run telemetry');
  for (const name of [
    'coordinatorCpuUserMicros',
    'coordinatorCpuSystemMicros',
    'coordinatorRssStartBytes',
    'coordinatorRssEndBytes',
    'coordinatorPeakSampledRssBytes',
    'workerPeakRssBytes',
    'workerCpuUserMicros',
    'workerCpuSystemMicros',
    'ownedProcessPeakRssBytes',
    'ownedProcessCountPeak',
    'ptySlotsPeak',
    'terminalOutputBytes',
    'semanticBytes',
    'semanticFullCount',
    'semanticDeltaCount',
    'journalAcceptedEvents',
    'journalAcceptedBytes',
    'journalSinkCalls',
    'journalPeakBacklogEvents',
    'journalPeakBacklogBytes',
    'traceBytes',
    'tempDiskPeakBytes',
    'finalArtifactBytes',
  ] as const) {
    const metric = value[name];
    if (metric !== 'unavailable' && (!Number.isFinite(metric) || metric < 0)) {
      throw new TypeError(`invalid run telemetry metric ${name}`);
    }
  }
}

function validateAttemptAgainstJournal(
  attempt: NativeRunAttempt,
  observed: { readonly start: RunEvent; readonly finish?: RunEvent } | undefined,
): void {
  if (observed === undefined)
    throw new TypeError(`attempt ${attempt.attemptId} is absent from canonical journal`);
  const start = observed.start;
  const payload = object(start.payload) ? start.payload : {};
  if (
    start.identity.executionId !== attempt.executionId ||
    start.identity.runnerTaskId !== attempt.runnerTaskId ||
    start.identity.projectId !== attempt.projectId ||
    start.identity.specId !== attempt.specId ||
    payload['nativeTaskId'] !== attempt.nativeTaskId ||
    payload['repeat'] !== attempt.repeat ||
    payload['retry'] !== attempt.retry
  ) {
    throw new TypeError(
      `attempt ${attempt.attemptId} index identity differs from canonical journal`,
    );
  }
  const finish = observed.finish;
  if (finish === undefined) {
    if (
      attempt.status !== 'incomplete' ||
      attempt.finishedAfterRunMs !== null ||
      attempt.durationMs !== null
    ) {
      throw new TypeError(`unfinished attempt ${attempt.attemptId} is not indexed as incomplete`);
    }
    return;
  }
  const finishPayload = object(finish.payload) ? finish.payload : {};
  if (
    finish.identity.executionId !== attempt.executionId ||
    finish.identity.runnerTaskId !== attempt.runnerTaskId ||
    finish.identity.projectId !== attempt.projectId ||
    finish.identity.specId !== attempt.specId ||
    finishPayload['nativeTaskId'] !== attempt.nativeTaskId ||
    finishPayload['repeat'] !== attempt.repeat ||
    finishPayload['retry'] !== attempt.retry ||
    finishPayload['state'] !== attempt.status ||
    attempt.finishedAfterRunMs === null ||
    attempt.durationMs !== Math.max(0, finish.monotonicTime - start.monotonicTime)
  ) {
    throw new TypeError(
      `attempt ${attempt.attemptId} terminal index differs from canonical journal`,
    );
  }
}
/** Canonical, injective and Windows-safe directory mapping for a canonical RunId. */
export function runDirectoryName(runId: RunId): string {
  parseRunId('run', runId);
  return runId.replace(':', '_');
}
function runIdFromDirectory(value: string): RunId | null {
  return safeRunId(value.replace(/^run_/, 'run:'));
}
function safeRunId(value: unknown): RunId | null {
  try {
    return parseRunId('run', value);
  } catch {
    return null;
  }
}
function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
async function durableWrite(path: string, body: string): Promise<void> {
  const file = await open(path, 'wx');
  try {
    await file.writeFile(body, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
}
async function readText(path: string): Promise<string | null> {
  try {
    const s = await stat(path);
    if (s.size > MAX_MANIFEST_BYTES) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
async function readEventText(path: string, expectedBytes: number): Promise<string | null> {
  try {
    const s = await stat(path);
    if (s.size !== expectedBytes) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return object(value) ? value : null;
  } catch {
    return null;
  }
}
function parseEventLines(raw: string): RunEvent[] | null {
  if (raw === '') return [];
  if (!raw.endsWith('\n')) return null;
  const events: RunEvent[] = [];
  for (const line of raw.slice(0, -1).split('\n')) {
    try {
      events.push(JSON.parse(line) as RunEvent);
    } catch {
      return null;
    }
  }
  return events;
}
async function readJson(path: string): Promise<unknown> {
  const raw = await readText(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
export const NODE_RUN_MANIFEST_WRITER = Object.freeze<RunManifestWriter>({
  async mkdir(path, options) {
    await mkdir(path, options);
  },
  exists,
  writeExclusive: durableWrite,
  async append(path, body) {
    await appendFile(path, body, 'utf8');
  },
  async syncFile(path) {
    const file = await open(path, 'r');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  },
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
  async rename(source, destination) {
    await rename(source, destination);
  },
});
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function finite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new TypeError(`${name} is invalid`);
}
function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function validateNumberRecord(value: unknown, name: string): void {
  if (!object(value) || Object.keys(value).length > 256) throw new TypeError(`invalid ${name}`);
  for (const [key, entry] of Object.entries(value))
    if (!text(key) || !nonNegativeInteger(entry)) throw new TypeError(`invalid ${name}`);
}
function validateStringRecord(value: unknown, name: string): void {
  if (!object(value) || Object.keys(value).length > 256) throw new TypeError(`invalid ${name}`);
  for (const [key, entry] of Object.entries(value))
    if (!text(key) || !text(entry) || entry.length > 16_384) throw new TypeError(`invalid ${name}`);
}
function startedAt(record: RunHistoryRecord): number {
  return record.state === 'complete'
    ? record.manifest.startedAt
    : record.state === 'incomplete'
      ? record.start.startedAt
      : 0;
}
function commitMarker(digest: string): string {
  return `termwright-run-history-v${RUN_HISTORY_COMMIT_VERSION} sha256:${digest}\n`;
}
