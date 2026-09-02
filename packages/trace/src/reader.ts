/**
 * {@link openTrace} — streaming reader for `.twtrace` archives, and the
 * `stateAt()` primitive the runner UI's time travel is built on.
 */

import { openArchive, type ArchiveFiles } from './archive.js';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  CONDITION_KINDS,
  EVIDENCE_PROVIDER_CAPABILITIES,
  parseRunId,
  SESSION_CAPABILITIES,
  type ContractProvider,
  type EffectiveSessionContract,
  type EvidenceProvenance,
} from '@termwright/protocol';
import { parseCastHeader, streamCastEvents, type CastEvent, type CastHeader } from './cast.js';
import { TraceError } from './errors.js';
import {
  TRACE_FILES,
  TRACE_VERSION,
  type SemanticRecord,
  type StepSummary,
  type TraceEvent,
  type TraceLogEntry,
  type TraceMeta,
} from './types.js';

/** Reconstructed session state at one point on the cast timeline. */
export interface TraceState {
  /** The requested cast-timeline offset, clamped to the recording. */
  readonly timeMs: number;
  /**
   * Concatenated asciicast output up to and including `timeMs`. Writing this
   * into a terminal emulator reproduces the screen at that moment.
   */
  readonly castPrefix: string;
  /** Viewport after applying every resize up to `timeMs`. */
  readonly columns: number;
  readonly rows: number;
  /** Revision of the newest semantic snapshot at or before `timeMs`. */
  readonly nearestSemanticRevision: number | null;
  /** That snapshot's full record, or `null` when the session had no tree. */
  readonly nearestSemantic: SemanticRecord | null;
  /** The innermost step covering `timeMs`, when any. */
  readonly step: StepSummary | null;
  /**
   * The application log entries leading up to `timeMs`, oldest first — what
   * the program was saying about itself as the screen reached this state.
   * Bounded by `StateOptions.logWindow`.
   */
  readonly logs: readonly TraceLogEntry[];
}

/** Options for {@link TraceReader.stateAt}. */
export interface StateOptions {
  /** How many preceding log entries to include. Default 20; `0` disables. */
  readonly logWindow?: number;
}

/** Streaming reader over one archive. */
export interface TraceReader {
  readonly meta: TraceMeta;
  readonly container: 'directory' | 'zip';
  readonly path: string;
  /** Parsed `session.cast` header. */
  castHeader(): Promise<CastHeader>;
  /** Streams cast events with absolute offsets resolved. */
  castEvents(): AsyncIterable<CastEvent>;
  /** Streams `events.jsonl`. */
  events(): AsyncIterable<TraceEvent>;
  /** Streams `semantics.jsonl`. */
  semantics(): AsyncIterable<SemanticRecord>;
  /** Streams `logs.jsonl`; empty when the session produced no logs. */
  logs(): AsyncIterable<TraceLogEntry>;
  /** Flattened step list, ordered by start time. Cached. */
  steps(): Promise<readonly StepSummary[]>;
  /** The newest semantic record at or before `castOffsetMs`. */
  semanticAt(castOffsetMs: number): Promise<SemanticRecord | null>;
  /**
   * The semantic tree the crash report points at, or `null` when the session
   * did not crash or had no tree. `meta.crash` stores only the revision, so
   * the snapshot is not duplicated between `meta.json` and `semantics.jsonl`.
   */
  crashSemantic(): Promise<SemanticRecord | null>;
  /** Everything the UI needs to render one point in time. */
  stateAt(timeMs: number, options?: StateOptions): Promise<TraceState>;
  close(): Promise<void>;
}

export type TraceArchiveInspection =
  | { readonly status: 'complete'; readonly reader: TraceReader }
  | {
      readonly status: 'incomplete' | 'corrupt' | 'unsupported-version';
      readonly path: string;
      readonly detail: string;
    };

/**
 * Opens a `.twtrace` directory or zip.
 *
 * @throws TraceError `not-found` when the path holds no archive, and
 *   `protocol-violation` when it holds a malformed or future-versioned one.
 *
 * @example
 * ```ts
 * const trace = await openTrace('out/login.twtrace');
 * const state = await trace.stateAt(1_500);
 * terminal.write(state.castPrefix);
 * console.log(state.nearestSemanticRevision);
 * await trace.close();
 * ```
 */
export async function openTrace(path: string): Promise<TraceReader> {
  if (basename(path).includes('.staging-')) {
    throw new TraceError('protocol-violation', `${path} is an incomplete staging trace`);
  }
  const files = await openArchive(path);
  try {
    const meta = parseMeta(await files.read(TRACE_FILES.meta), path);
    await verifyCommit(files, path);
    return new ArchiveReader(files, meta);
  } catch (error) {
    await files.close();
    throw error;
  }
}

/** Classify a present trace artifact without making callers parse errors. */
export async function inspectTrace(path: string): Promise<TraceArchiveInspection> {
  try {
    return { status: 'complete', reader: await openTrace(path) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/unsupported trace version/u.test(detail))
      return { status: 'unsupported-version', path, detail };
    if (/has no transactional commit marker|incomplete staging trace/u.test(detail)) {
      return { status: 'incomplete', path, detail };
    }
    return { status: 'corrupt', path, detail };
  }
}

async function verifyCommit(files: ArchiveFiles, path: string): Promise<void> {
  if (!(await files.has(TRACE_FILES.commit))) {
    throw new TraceError('protocol-violation', `${path} has no transactional commit marker`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await files.read(TRACE_FILES.commit));
  } catch {
    throw new TraceError('protocol-violation', `${path}: COMMITTED is not valid JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TraceError('protocol-violation', `${path}: COMMITTED is not an object`);
  }
  const record = parsed as Record<string, unknown>;
  const checksums = record['checksums'];
  if (
    record['v'] !== 1 ||
    typeof checksums !== 'object' ||
    checksums === null ||
    Array.isArray(checksums)
  ) {
    throw new TraceError('protocol-violation', `${path}: COMMITTED has an unsupported shape`);
  }
  for (const [name, expected] of Object.entries(checksums as Record<string, unknown>)) {
    if (
      !Object.values(TRACE_FILES).includes(name as never) ||
      name === TRACE_FILES.commit ||
      typeof expected !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(expected)
    ) {
      throw new TraceError('protocol-violation', `${path}: COMMITTED contains an invalid member`);
    }
    const actual = createHash('sha256')
      .update(await files.read(name))
      .digest('hex');
    if (actual !== expected) {
      throw new TraceError('protocol-violation', `${path}: checksum mismatch for ${name}`);
    }
  }
  for (const required of [
    TRACE_FILES.meta,
    TRACE_FILES.cast,
    TRACE_FILES.events,
    TRACE_FILES.semantics,
  ]) {
    if (!(required in (checksums as Record<string, unknown>))) {
      throw new TraceError('protocol-violation', `${path}: COMMITTED omits ${required}`);
    }
  }
}

function parseMeta(text: string, path: string): TraceMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TraceError('protocol-violation', `${path}: meta.json is not valid JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TraceError('protocol-violation', `${path}: meta.json is not an object`);
  }
  const meta = parsed as TraceMeta;
  if (meta.v !== TRACE_VERSION) {
    throw new TraceError(
      'protocol-violation',
      `${path}: unsupported trace version ${String(meta.v)} (expected ${TRACE_VERSION})`,
      {
        suggestion: 'Upgrade @termwright/trace, or re-record with the current version.',
      },
    );
  }
  if (typeof meta.sessionId !== 'string') {
    throw new TraceError('protocol-violation', `${path}: meta.sessionId is missing`);
  }
  if (meta.runIdentity !== undefined) parseRunIdentity(meta.runIdentity, path);
  if (meta.contract === undefined) return meta;
  return {
    ...meta,
    contract: parseContract(meta.contract, meta.sessionId, path),
  };
}

function parseRunIdentity(value: unknown, path: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TraceError('protocol-violation', `${path}: meta.runIdentity is not an object`);
  }
  const identity = value as Record<string, unknown>;
  const required = [
    ['invocation', 'invocationId'],
    ['run', 'runId'],
    ['project', 'projectId'],
    ['spec', 'specId'],
    ['runner-task', 'runnerTaskId'],
    ['execution', 'executionId'],
    ['attempt', 'attemptId'],
    ['session', 'sessionId'],
  ] as const;
  try {
    for (const [kind, key] of required) parseRunId(kind, identity[key]);
    if (identity['shardId'] !== undefined) parseRunId('shard', identity['shardId']);
  } catch (error) {
    throw new TraceError(
      'protocol-violation',
      `${path}: invalid meta.runIdentity: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseContract(value: unknown, sessionId: string, path: string): EffectiveSessionContract {
  const fail = (detail: string): never => {
    throw new TraceError('protocol-violation', `${path}: meta.contract ${detail}`);
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('is not an object');
  const contract = value as Record<string, unknown>;
  if (contract['protocol'] !== 'termwright/3' || contract['sessionId'] !== sessionId)
    fail('does not identify this v2 session');
  const nonEmpty = (candidate: unknown, field: string): string => {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 2_048)
      fail(`${field} is invalid`);
    return candidate as string;
  };
  const integer = (candidate: unknown, field: string): number => {
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 0) fail(`${field} is invalid`);
    return candidate as number;
  };
  const parseEvidence = (candidate: unknown, field: string): EvidenceProvenance => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
      fail(`${field} is invalid`);
    const record = candidate as Record<string, unknown>;
    const source = record['source'];
    const method = record['method'];
    const strength = record['strength'];
    if (
      !['framework', 'application', 'terminal', 'recognizer', 'driver'].includes(String(source)) ||
      ![
        'native',
        'instrumented',
        'declared',
        'correlated',
        'measured',
        'derived',
        'heuristic',
      ].includes(String(method)) ||
      (strength !== 'authoritative' && strength !== 'diagnostic')
    )
      fail(`${field} has invalid provenance`);
    return Object.freeze({
      source: source as EvidenceProvenance['source'],
      method: method as EvidenceProvenance['method'],
      strength: strength as EvidenceProvenance['strength'],
      providerId: nonEmpty(record['providerId'], `${field}.providerId`),
    });
  };
  const rawCapabilities = contract['capabilities'];
  if (
    typeof rawCapabilities !== 'object' ||
    rawCapabilities === null ||
    Array.isArray(rawCapabilities)
  )
    fail('capabilities are invalid');
  const capabilityRecord = rawCapabilities as Record<string, unknown>;
  if (
    Object.keys(capabilityRecord).length !== SESSION_CAPABILITIES.length ||
    Object.keys(capabilityRecord).some((key) => !SESSION_CAPABILITIES.includes(key as never))
  )
    fail('capabilities are not the closed v2 set');
  const capabilities = Object.fromEntries(
    SESSION_CAPABILITIES.map((id) => {
      const candidate = capabilityRecord[id];
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
        fail(`capability ${id} is invalid`);
      const availability = candidate as Record<string, unknown>;
      if (availability['status'] === 'supported')
        return [
          id,
          Object.freeze({
            status: 'supported',
            evidence: parseEvidence(availability['evidence'], `capability ${id}`),
          }),
        ];
      if (
        availability['status'] !== 'unsupported' ||
        ![
          'not-negotiated',
          'framework-unobservable',
          'terminal-unobservable',
          'provider-required',
        ].includes(String(availability['reason']))
      )
        fail(`capability ${id} is invalid`);
      return [
        id,
        Object.freeze({
          status: 'unsupported',
          reason: availability['reason'],
        }),
      ];
    }),
  ) as unknown as EffectiveSessionContract['capabilities'];
  const rawProviders = contract['providers'];
  if (!Array.isArray(rawProviders) || rawProviders.length > 128) fail('providers are invalid');
  const providers: ContractProvider[] = (rawProviders as unknown[]).map(
    (candidate, index): ContractProvider => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
        fail(`provider ${index} is invalid`);
      const provider = candidate as Record<string, unknown>;
      const kind = provider['kind'];
      const base = {
        id: nonEmpty(provider['id'], `provider ${index}.id`),
        version: nonEmpty(provider['version'], `provider ${index}.version`),
      };
      if (kind === 'framework' || kind === 'terminal') return Object.freeze({ ...base, kind });
      if (
        kind !== 'application' ||
        (provider['method'] !== 'native' && provider['method'] !== 'declared') ||
        !Array.isArray(provider['capabilities']) ||
        provider['capabilities'].length === 0 ||
        provider['capabilities'].length > EVIDENCE_PROVIDER_CAPABILITIES.length ||
        new Set(provider['capabilities']).size !== provider['capabilities'].length ||
        !provider['capabilities'].every((item) =>
          EVIDENCE_PROVIDER_CAPABILITIES.includes(item as never),
        )
      )
        fail(`provider ${index} is invalid`);
      const providerCapabilities = provider[
        'capabilities'
      ] as import('@termwright/protocol').EvidenceProviderCapability[];
      return Object.freeze({
        ...base,
        kind,
        method: provider['method'],
        capabilities: Object.freeze([...providerCapabilities]),
      }) as Extract<EffectiveSessionContract['providers'][number], { kind: 'application' }>;
    },
  );
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length)
    fail('providers contain duplicate ids');
  for (const capability of ['pointer-regions', 'hit-test'] as const) {
    const owners = providers.filter(
      (provider) => provider.kind === 'application' && provider.capabilities.includes(capability),
    );
    if (owners.length > 1) fail(`providers contain competing ${capability} owners`);
  }
  for (const availability of Object.values(capabilities)) {
    if (availability.status !== 'supported') continue;
    const expectedKind =
      availability.evidence.source === 'framework' ||
      availability.evidence.source === 'terminal' ||
      availability.evidence.source === 'application'
        ? availability.evidence.source
        : null;
    if (
      expectedKind !== null &&
      !providers.some(
        (provider) =>
          provider.id === availability.evidence.providerId && provider.kind === expectedKind,
      )
    ) {
      fail('capability evidence names an unknown provider');
    }
  }
  const rawTerminal = contract['terminal'];
  if (typeof rawTerminal !== 'object' || rawTerminal === null || Array.isArray(rawTerminal))
    fail('terminal is invalid');
  const terminal = rawTerminal as Record<string, unknown>;
  if (typeof terminal['mouseModesObservable'] !== 'boolean')
    fail('terminal.mouseModesObservable is invalid');
  const rawFramework = contract['framework'];
  let framework: EffectiveSessionContract['framework'] = null;
  if (rawFramework !== null) {
    if (typeof rawFramework !== 'object' || Array.isArray(rawFramework))
      fail('framework is invalid');
    const item = rawFramework as Record<string, unknown>;
    framework = Object.freeze({
      name: nonEmpty(item['name'], 'framework.name'),
      version: nonEmpty(item['version'], 'framework.version'),
      adapterVersion: nonEmpty(item['adapterVersion'], 'framework.adapterVersion'),
      certificationId: nonEmpty(item['certificationId'], 'framework.certificationId'),
    });
  }
  return Object.freeze({
    contractId: nonEmpty(contract['contractId'], 'contractId'),
    sessionId,
    epoch: integer(contract['epoch'], 'epoch'),
    protocol: 'termwright/3',
    framework,
    providers: Object.freeze(providers),
    capabilities: Object.freeze(capabilities),
    terminal: Object.freeze({
      profile: nonEmpty(terminal['profile'], 'terminal.profile'),
      platform: nonEmpty(terminal['platform'], 'terminal.platform'),
      mouseModesObservable: terminal['mouseModesObservable'] as boolean,
    }),
  });
}

interface SemanticIndexEntry {
  readonly line: number;
  readonly t: number;
  readonly revision: number;
  readonly castOffset: number;
}

class ArchiveReader implements TraceReader {
  readonly meta: TraceMeta;
  readonly #files: ArchiveFiles;
  #steps: readonly StepSummary[] | null = null;
  #semanticIndex: readonly SemanticIndexEntry[] | null = null;

  constructor(files: ArchiveFiles, meta: TraceMeta) {
    this.#files = files;
    this.meta = meta;
  }

  get container(): 'directory' | 'zip' {
    return this.#files.container;
  }

  get path(): string {
    return this.#files.path;
  }

  async castHeader(): Promise<CastHeader> {
    for await (const line of this.#files.lines(TRACE_FILES.cast)) {
      return parseCastHeader(line);
    }
    throw new TraceError('protocol-violation', `${this.path}: session.cast is empty`);
  }

  castEvents(): AsyncIterable<CastEvent> {
    return streamCastEvents(this.#files.lines(TRACE_FILES.cast));
  }

  events(): AsyncIterable<TraceEvent> {
    return validateEvents(
      parseJsonLines<TraceEvent>(this.#files.lines(TRACE_FILES.events), TRACE_FILES.events),
    );
  }

  semantics(): AsyncIterable<SemanticRecord> {
    return parseJsonLines<SemanticRecord>(
      this.#files.lines(TRACE_FILES.semantics),
      TRACE_FILES.semantics,
    );
  }

  logs(): AsyncIterable<TraceLogEntry> {
    return parseJsonLines<TraceLogEntry>(this.#files.lines(TRACE_FILES.logs), TRACE_FILES.logs);
  }

  /**
   * The last `limit` entries at or before `castOffsetMs`, oldest first.
   *
   * Deliberately not gated on `meta.logs`: the summary and the file are two
   * statements about the same thing, and an archive where they disagree is one
   * a reader should survive rather than believe. Streaming an absent
   * `logs.jsonl` yields nothing anyway, so the gate only bought a divergence
   * between this and {@link TraceReader.logs}.
   */
  async #logsBefore(castOffsetMs: number, limit: number): Promise<readonly TraceLogEntry[]> {
    if (limit <= 0) return [];
    const window: TraceLogEntry[] = [];
    for await (const entry of this.logs()) {
      if (entry.castOffset > castOffsetMs) break;
      window.push(entry);
      if (window.length > limit) window.shift();
    }
    return window;
  }

  async steps(): Promise<readonly StepSummary[]> {
    if (this.#steps !== null) return this.#steps;
    const open = new Map<string, StepSummary>();
    const ordered: StepSummary[] = [];
    for await (const event of this.events()) {
      const castOffset = event.castOffset;
      if (event.kind === 'step-start') {
        const summary: StepSummary = {
          stepId: event.stepId,
          title: event.title,
          ...(event.parentStepId === undefined ? {} : { parentStepId: event.parentStepId }),
          ...(event.gherkin === undefined ? {} : { gherkin: event.gherkin }),
          startedAt: event.t,
          endedAt: null,
          castOffset,
          castEndOffset: null,
          status: null,
        };
        open.set(event.stepId, summary);
        ordered.push(summary);
      } else if (event.kind === 'step-end') {
        const started = open.get(event.stepId);
        if (started === undefined) continue;
        open.delete(event.stepId);
        const index = ordered.indexOf(started);
        ordered[index] = {
          ...started,
          endedAt: event.t,
          castEndOffset: castOffset,
          status: event.status,
          ...(event.error === undefined ? {} : { error: event.error }),
        };
      }
    }
    this.#steps = ordered;
    return ordered;
  }

  async #index(): Promise<readonly SemanticIndexEntry[]> {
    if (this.#semanticIndex !== null) return this.#semanticIndex;
    const entries: SemanticIndexEntry[] = [];
    let line = 0;
    for await (const record of this.semantics()) {
      entries.push({
        line,
        t: record.t,
        revision: record.revision,
        castOffset: record.castOffset,
      });
      line += 1;
    }
    this.#semanticIndex = entries;
    return entries;
  }

  async semanticAt(castOffsetMs: number): Promise<SemanticRecord | null> {
    const index = await this.#index();
    let candidate: SemanticIndexEntry | null = null;
    for (const entry of index) {
      if (entry.castOffset <= castOffsetMs) candidate = entry;
      else break;
    }
    if (candidate === null) return null;
    let line = 0;
    for await (const record of this.semantics()) {
      if (line === candidate.line) return record;
      line += 1;
    }
    return null;
  }

  async crashSemantic(): Promise<SemanticRecord | null> {
    const revision = this.meta.crash?.lastSemanticRevision;
    if (revision === undefined || revision === null) return null;
    for await (const record of this.semantics()) {
      if (record.revision === revision) return record;
    }
    return null;
  }

  async stateAt(timeMs: number, options: StateOptions = {}): Promise<TraceState> {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw new TraceError('protocol-violation', `stateAt(${timeMs}): time must be >= 0`);
    }
    const header = await this.castHeader();
    let columns = header.term.cols;
    let rows = header.term.rows;
    let reached = 0;
    const output: string[] = [];
    for await (const event of this.castEvents()) {
      if (event.timeMs > timeMs) break;
      reached = event.timeMs;
      if (event.code === 'o') output.push(event.data);
      else if (event.code === 'r') {
        const size = parseSize(event.data);
        if (size !== null) {
          columns = size.columns;
          rows = size.rows;
        }
      }
    }
    const semantic = await this.semanticAt(timeMs);
    const step = findStep(await this.steps(), timeMs);
    const logs = await this.#logsBefore(timeMs, options.logWindow ?? 20);
    return {
      timeMs: reached,
      castPrefix: output.join(''),
      columns,
      rows,
      nearestSemanticRevision: semantic?.revision ?? null,
      nearestSemantic: semantic,
      step,
      logs,
    };
  }

  async close(): Promise<void> {
    await this.#files.close();
  }
}

function findStep(steps: readonly StepSummary[], timeMs: number): StepSummary | null {
  let best: StepSummary | null = null;
  for (const step of steps) {
    const end = step.castEndOffset ?? Number.POSITIVE_INFINITY;
    if (step.castOffset <= timeMs && timeMs <= end) {
      // Later entries are nested more deeply; the last match is the innermost.
      best = step;
    }
  }
  return best;
}

function parseSize(data: string): { columns: number; rows: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(data);
  if (match === null) return null;
  return { columns: Number(match[1]), rows: Number(match[2]) };
}

/**
 * Rejects event lines that cannot be placed on the recording.
 *
 * `castOffset` is required by §Trace. Falling back to `t` would put an event
 * at the wrong moment in any recording that was hidden or idle-trimmed, and
 * do it silently — a corrupt line is better news than a plausible lie.
 */
async function* validateEvents(events: AsyncIterable<TraceEvent>): AsyncGenerator<TraceEvent> {
  let lineNumber = 0;
  for await (const event of events) {
    lineNumber += 1;
    if (typeof event !== 'object' || event === null || Array.isArray(event)) {
      throw invalidEvent(lineNumber, 'is not an object');
    }
    if (typeof event.castOffset !== 'number' || !Number.isFinite(event.castOffset)) {
      throw new TraceError(
        'protocol-violation',
        `${TRACE_FILES.events}:${lineNumber} has no castOffset`,
        {
          suggestion:
            'The archive predates the required castOffset field, or was written by something other than @termwright/trace. Re-record it.',
        },
      );
    }
    if (event.kind === 'action' && event.receipt !== undefined) {
      validateActionReceipt(event.receipt, lineNumber);
    }
    if (event.kind === 'action' && event.actionability !== undefined) {
      validateActionability(event.actionability, lineNumber, event.ok);
    }
    if (event.kind === 'input') {
      const input = event as unknown as Record<string, unknown>;
      if (input['recording'] === 'raw') {
        boundedString(input['dataB64'], lineNumber, 'input.dataB64');
        if (input['withheldReason'] !== undefined)
          throw invalidEvent(lineNumber, 'raw input also has a withheld marker');
      } else if (input['recording'] === 'withheld') {
        if (input['dataB64'] !== undefined || input['withheldReason'] !== 'artifact-policy') {
          throw invalidEvent(lineNumber, 'withheld input contains bytes or has an invalid reason');
        }
      } else {
        throw invalidEvent(lineNumber, 'input recording mode is invalid');
      }
    }
    yield event;
  }
}

function validateActionability(value: unknown, line: number, eventOk: boolean): void {
  const explanation = object(value, line, 'actionability');
  if (typeof explanation['actionable'] !== 'boolean')
    throw invalidEvent(line, 'actionability.actionable is invalid');
  if (eventOk || explanation['actionable'] !== false)
    throw invalidEvent(line, 'actionability is only valid for a rejected action');
  const intent = object(explanation['intent'], line, 'actionability.intent');
  boundedString(intent['kind'], line, 'actionability.intent.kind');
  const checkpoint = stamp(explanation['checkpoint'], line, 'actionability.checkpoint');
  const requirements = explanation['requirements'];
  if (!Array.isArray(requirements) || requirements.length > 128)
    throw invalidEvent(line, 'actionability.requirements must be a bounded array');
  for (const [index, raw] of requirements.entries()) {
    if (
      !sameStamp(validateRequirement(raw, line, `actionability.requirements[${index}]`), checkpoint)
    ) {
      throw invalidEvent(
        line,
        `actionability.requirements[${index}] belongs to another checkpoint`,
      );
    }
  }
  const reason = object(explanation['reason'], line, 'actionability.reason');
  boundedString(reason['code'], line, 'actionability.reason.code');
  boundedString(reason['message'], line, 'actionability.reason.message');
}

function validateActionReceipt(value: unknown, line: number): void {
  const receipt = object(value, line, 'receipt');
  const intent = object(receipt['intent'], line, 'receipt.intent');
  const plan = object(receipt['plan'], line, 'receipt.plan');
  const planIntent = object(plan['intent'], line, 'receipt.plan.intent');
  const before = stamp(receipt['before'], line, 'receipt.before');
  const after = stamp(receipt['after'], line, 'receipt.after');
  const checkpoint = stamp(plan['checkpoint'], line, 'receipt.plan.checkpoint');
  const kind = boundedString(intent['kind'], line, 'receipt.intent.kind');
  if (boundedString(planIntent['kind'], line, 'receipt.plan.intent.kind') !== kind) {
    throw invalidEvent(line, 'receipt intent differs from its plan');
  }
  const actionId = boundedString(plan['actionId'], line, 'receipt.plan.actionId');
  const contractId = boundedString(plan['contractId'], line, 'receipt.plan.contractId');
  boundedString(plan['strategy'], line, 'receipt.plan.strategy');
  const valuePolicy = plan['valuePolicy'];
  if (valuePolicy !== 'none' && valuePolicy !== 'redacted' && valuePolicy !== 'raw') {
    throw invalidEvent(line, 'receipt.plan.valuePolicy is invalid');
  }
  if (actionId.length === 0 || contractId !== before.contractId || !sameStamp(checkpoint, before)) {
    throw invalidEvent(line, 'receipt plan is not bound to its before checkpoint');
  }
  if (
    after.sessionId !== before.sessionId ||
    after.contractId !== before.contractId ||
    after.epoch !== before.epoch ||
    after.sequence < before.sequence
  ) {
    throw invalidEvent(
      line,
      'receipt after checkpoint belongs to another contract or precedes before',
    );
  }
  const planned = operations(plan['operations'], line, 'receipt.plan.operations', valuePolicy);
  const executed = operations(receipt['executed'], line, 'receipt.executed', valuePolicy);
  const outcome = receipt['outcome'];
  if (outcome !== 'completed' && outcome !== 'partial' && outcome !== 'failed') {
    throw invalidEvent(line, 'receipt.outcome is invalid');
  }
  if (outcome === 'completed' && JSON.stringify(planned) !== JSON.stringify(executed)) {
    throw invalidEvent(line, 'completed receipt executed input differs from its plan');
  }
  const requirements = plan['requirements'];
  if (!Array.isArray(requirements) || requirements.length > 128) {
    throw invalidEvent(line, 'receipt.plan.requirements must be a bounded array');
  }
  for (const [index, raw] of requirements.entries()) {
    if (
      !sameStamp(validateRequirement(raw, line, `receipt.plan.requirements[${index}]`), checkpoint)
    ) {
      throw invalidEvent(line, `receipt.plan.requirements[${index}] belongs to another checkpoint`);
    }
  }
  if (plan['physicalRegion'] !== undefined) {
    const region = object(plan['physicalRegion'], line, 'receipt.plan.physicalRegion');
    provenance(region['evidence'], line, 'receipt.plan.physicalRegion.evidence');
  }
}

function validateRequirement(raw: unknown, line: number, path: string): ReturnType<typeof stamp> {
  const requirement = object(raw, line, path);
  validateCondition(requirement['condition'], line, `${path}.condition`);
  const checkpoint = stamp(requirement['checkpoint'], line, `${path}.checkpoint`);
  const verdict = requirement['verdict'];
  if (verdict !== 'satisfied' && verdict !== 'unsatisfied' && verdict !== 'inconclusive')
    throw invalidEvent(line, `${path}.verdict is invalid`);
  const observation = object(requirement['observation'], line, `${path}.observation`);
  switch (observation['status']) {
    case 'known':
      if (typeof observation['value'] !== 'boolean')
        throw invalidEvent(line, `${path}.observation known value is invalid`);
      provenance(observation['evidence'], line, `${path}.observation.evidence`, false);
      break;
    case 'absent':
      if (!['detached', 'not-displayed', 'not-laid-out'].includes(String(observation['reason'])))
        throw invalidEvent(line, `${path}.observation absent reason is invalid`);
      provenance(observation['evidence'], line, `${path}.observation.evidence`);
      break;
    case 'unknown':
      if (
        !['awaiting-revision-pair', 'provider-refresh', 'stale-revision'].includes(
          String(observation['reason']),
        )
      )
        throw invalidEvent(line, `${path}.observation unknown reason is invalid`);
      break;
    case 'unsupported':
      boundedString(observation['capability'], line, `${path}.observation.capability`);
      if (
        !['capability', 'framework-unobservable', 'not-negotiated'].includes(
          String(observation['reason']),
        )
      )
        throw invalidEvent(line, `${path}.observation unsupported reason is invalid`);
      break;
    default:
      throw invalidEvent(line, `${path}.observation status is invalid`);
  }
  return checkpoint;
}

function validateCondition(value: unknown, line: number, path: string, depth = 0): void {
  if (depth > 16) throw invalidEvent(line, `${path} is nested too deeply`);
  const condition = object(value, line, path);
  const kind = boundedString(condition['kind'], line, `${path}.kind`);
  if (!CONDITION_KINDS.includes(kind as (typeof CONDITION_KINDS)[number]))
    throw invalidEvent(line, `${path}.kind is invalid`);
  if (kind === 'not') {
    validateCondition(condition['condition'], line, `${path}.condition`, depth + 1);
    return;
  }
  if (kind === 'all' || kind === 'any') {
    if (!Array.isArray(condition['conditions']) || condition['conditions'].length > 128)
      throw invalidEvent(line, `${path}.conditions must be a bounded array`);
    condition['conditions'].forEach((nested, index) =>
      validateCondition(nested, line, `${path}.conditions[${index}]`, depth + 1),
    );
    return;
  }
  boundedString(condition['target'], line, `${path}.target`);
  if (
    kind === 'in-viewport' &&
    (typeof condition['minRatio'] !== 'number' ||
      !Number.isFinite(condition['minRatio']) ||
      condition['minRatio'] < 0 ||
      condition['minRatio'] > 1)
  ) {
    throw invalidEvent(line, `${path}.minRatio is invalid`);
  }
  if (
    (kind === 'checked' || kind === 'selected' || kind === 'expanded') &&
    typeof condition['value'] !== 'boolean'
  ) {
    throw invalidEvent(line, `${path}.value is invalid`);
  }
  if (kind === 'value') {
    const matcher = object(condition['matcher'], line, `${path}.matcher`);
    if (matcher['kind'] === 'regex') {
      boundedString(matcher['source'], line, `${path}.matcher.source`);
      boundedString(matcher['flags'], line, `${path}.matcher.flags`);
      try {
        new RegExp(String(matcher['source']), String(matcher['flags']));
      } catch {
        throw invalidEvent(line, `${path}.matcher is not a valid regular expression`);
      }
    } else if (matcher['kind'] === 'exact' || matcher['kind'] === 'substring') {
      boundedString(matcher['text'], line, `${path}.matcher.text`);
    } else {
      throw invalidEvent(line, `${path}.matcher.kind is invalid`);
    }
  }
}

function operations(
  value: unknown,
  line: number,
  path: string,
  valuePolicy: 'none' | 'redacted' | 'raw',
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > 10_000)
    throw invalidEvent(line, `${path} must be a bounded array`);
  return value.map((raw, index) => {
    const operation = object(raw, line, `${path}[${index}]`);
    if (operation['device'] !== 'keyboard' && operation['device'] !== 'mouse') {
      throw invalidEvent(line, `${path}[${index}].device is invalid`);
    }
    boundedString(operation['kind'], line, `${path}[${index}].kind`);
    if (operation['device'] === 'keyboard') {
      const value = object(operation['value'], line, `${path}[${index}].value`);
      if (value['status'] === 'known') {
        boundedString(value['value'], line, `${path}[${index}].value.value`);
        if (value['sensitivity'] !== 'public' && value['sensitivity'] !== 'sensitive') {
          throw invalidEvent(line, `${path}[${index}].value.sensitivity is invalid`);
        }
        if (
          (operation['kind'] !== 'press' || value['sensitivity'] !== 'public') &&
          (valuePolicy === 'none' ||
            (valuePolicy === 'redacted' && value['sensitivity'] === 'sensitive'))
        ) {
          throw invalidEvent(
            line,
            `${path}[${index}] contains a value forbidden by its artifact policy`,
          );
        }
      } else if (value['status'] === 'withheld') {
        if (
          value['reason'] !== 'artifact-policy' ||
          !['public', 'sensitive', 'unknown'].includes(String(value['sensitivity']))
        ) {
          throw invalidEvent(line, `${path}[${index}].value withheld marker is invalid`);
        }
      } else {
        throw invalidEvent(line, `${path}[${index}].value.status is invalid`);
      }
    }
    if (operation['device'] === 'mouse' && operation['modifiers'] !== undefined) {
      const modifiers = operation['modifiers'];
      if (
        !Array.isArray(modifiers) ||
        modifiers.length > 3 ||
        new Set(modifiers).size !== modifiers.length ||
        !modifiers.every(
          (modifier) => modifier === 'shift' || modifier === 'alt' || modifier === 'control',
        )
      ) {
        throw invalidEvent(line, `${path}[${index}].modifiers is invalid`);
      }
    }
    return operation;
  });
}

function stamp(
  value: unknown,
  line: number,
  path: string,
): {
  sessionId: string;
  contractId: string;
  epoch: number;
  sequence: number;
  screenRevision: number;
  semanticRevision: number | null;
  pairedScreenRevision: number | null;
} {
  const result = object(value, line, path);
  const numeric = (key: string, nullable = false): number | null => {
    const candidate = result[key];
    if (nullable && candidate === null) return null;
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 0)
      throw invalidEvent(line, `${path}.${key} is invalid`);
    return candidate as number;
  };
  return {
    sessionId: boundedString(result['sessionId'], line, `${path}.sessionId`),
    contractId: boundedString(result['contractId'], line, `${path}.contractId`),
    epoch: numeric('epoch') as number,
    sequence: numeric('sequence') as number,
    screenRevision: numeric('screenRevision') as number,
    semanticRevision: numeric('semanticRevision', true),
    pairedScreenRevision: numeric('pairedScreenRevision', true),
  };
}

function sameStamp(left: ReturnType<typeof stamp>, right: ReturnType<typeof stamp>): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.contractId === right.contractId &&
    left.epoch === right.epoch &&
    left.sequence === right.sequence &&
    left.screenRevision === right.screenRevision &&
    left.semanticRevision === right.semanticRevision &&
    left.pairedScreenRevision === right.pairedScreenRevision
  );
}

function provenance(value: unknown, line: number, path: string, authoritativeOnly = true): void {
  const evidence = object(value, line, path);
  const sources = ['framework', 'application', 'terminal', 'recognizer', 'driver'];
  const methods = [
    'native',
    'instrumented',
    'declared',
    'correlated',
    'measured',
    'derived',
    'heuristic',
  ];
  if (
    !sources.includes(String(evidence['source'])) ||
    !methods.includes(String(evidence['method'])) ||
    (authoritativeOnly
      ? evidence['strength'] !== 'authoritative'
      : evidence['strength'] !== 'authoritative' && evidence['strength'] !== 'diagnostic')
  )
    throw invalidEvent(line, `${path} has invalid evidence`);
  boundedString(evidence['providerId'], line, `${path}.providerId`);
}

function object(value: unknown, line: number, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalidEvent(line, `${path} is not an object`);
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, line: number, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048)
    throw invalidEvent(line, `${path} is invalid`);
  return value;
}

function invalidEvent(line: number, detail: string): TraceError {
  return new TraceError('protocol-violation', `${TRACE_FILES.events}:${line} ${detail}`);
}

async function* parseJsonLines<T>(lines: AsyncIterable<string>, file: string): AsyncGenerator<T> {
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    try {
      yield JSON.parse(line) as T;
    } catch {
      throw new TraceError('protocol-violation', `${file}:${lineNumber} is not valid JSON`);
    }
  }
}
