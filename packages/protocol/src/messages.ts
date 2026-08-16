import { z } from 'zod';
import type { SemanticSnapshot } from './tree.js';
import type { LogRecord } from './logs.js';
import type { ProtocolLimits } from './limits.js';
import { PROTOCOL_ID } from './env.js';
import { ProtocolViolation } from './errors.js';
import { projectDto } from './framing.js';
import { validateSnapshot } from './validate.js';
import { validateLogRecord } from './logs.js';

/**
 * Wire messages. Transport: length-prefixed JSON frames (see framing.ts).
 * CDP-like: adapter pushes commits; driver issues requests; either side may
 * send errors. All messages are validated against limits BEFORE retention.
 */

export const ADAPTER_CAPABILITIES = [
  'tree',
  'bounds',
  'absolute-bounds',
  'states',
  'actions',
  'text-ranges',
  'render-revisions',
  'tree-diffs',
  'logs',
] as const;
export type AdapterCapability = (typeof ADAPTER_CAPABILITIES)[number];

/** adapter → driver, exactly once, before any other message. */
export interface HelloMessage {
  readonly type: 'hello';
  readonly protocol: 'termwright/1';
  readonly token: string;
  readonly adapter: { readonly name: string; readonly version: string };
  readonly capabilities: readonly AdapterCapability[];
}

/** driver → adapter, reply to hello. */
export interface HelloAckMessage {
  readonly type: 'hello-ack';
  readonly protocol: 'termwright/1';
  readonly sessionId: string;
  readonly limits: ProtocolLimits;
  /** Which traffic the driver wants pushed. v1 drivers request 'snapshots'. */
  readonly subscribe: 'snapshots' | 'revisions';
  /** Marker configuration: adapter must emit DCS marker with this nonce base. */
  readonly marker: { readonly enabled: boolean };
  /**
   * Log-channel budget, sent only when the adapter announced the `logs`
   * capability. **Absent means logs are disabled** — an adapter that receives
   * no `logs` field must not emit `log` messages at all.
   *
   * The adapter enforces the rate itself and drops locally when over budget,
   * leaving a gap in `LogRecord.seq` so the driver can report how many records
   * were lost. Enforcing it at the source is what keeps a log storm from
   * consuming the frame budget the semantic tree needs.
   */
  readonly logs?: {
    readonly enabled: boolean;
    /** Sustained ceiling on records per second. */
    readonly maxRecordsPerSecond: number;
    /** Records allowed in a burst on top of the sustained rate. */
    readonly burst: number;
  };
}

/** adapter → driver after each committed render (always, regardless of mode). */
export interface RevisionCommitMessage {
  readonly type: 'revision-commit';
  readonly revision: number;
}

/** adapter → driver, full snapshot for a revision (subscribe: 'snapshots'). */
export interface SnapshotMessage {
  readonly type: 'snapshot';
  readonly snapshot: SemanticSnapshot;
}

/** driver → adapter, request full snapshot (latest, or a held revision). */
export interface GetTreeRequest {
  readonly type: 'get-tree';
  readonly requestId: number;
  readonly revision?: number;
}

/** adapter → driver, response to get-tree. */
export interface GetTreeResponse {
  readonly type: 'get-tree-result';
  readonly requestId: number;
  readonly snapshot?: SemanticSnapshot;
  readonly error?: string;
}

/**
 * adapter → driver, one application log record (capability `logs`).
 *
 * Sent only after the driver enabled logs in `hello-ack`. Records are
 * independent of renders: they are not paired with a revision and never gate
 * snapshot publication.
 */
export interface LogMessage {
  readonly type: 'log';
  readonly record: LogRecord;
}

/** either direction: terminal protocol error; sender closes after emitting. */
export interface ProtocolErrorMessage {
  readonly type: 'error';
  readonly code:
    | 'bad-token'
    | 'bad-version'
    | 'malformed'
    | 'limit-exceeded'
    | 'internal';
  readonly message: string;
}

export type AdapterToDriverMessage =
  | HelloMessage
  | RevisionCommitMessage
  | SnapshotMessage
  | GetTreeResponse
  | LogMessage
  | ProtocolErrorMessage;

export type DriverToAdapterMessage =
  | HelloAckMessage
  | GetTreeRequest
  | ProtocolErrorMessage;

// --------------------------------------------------------------------------
// Runtime validation
//
// The interfaces above are the contract; the schemas below are how untrusted
// bytes become instances of it. Every parse projects the value into a frozen
// plain DTO first, so a getter on hostile input is rejected without running.
// --------------------------------------------------------------------------

/** Outcome of parsing one wire message. Mirrors `ProtocolErrorMessage['code']`. */
export type MessageParseResult<T> =
  | { readonly ok: true; readonly message: T }
  | {
      readonly ok: false;
      readonly code: 'bad-version' | 'malformed' | 'limit-exceeded';
      readonly detail: string;
    };

/** Longest token/identifier/message string accepted, in UTF-16 code units. */
const MAX_IDENTIFIER_LENGTH = 1024;

const identifier = z.string().max(MAX_IDENTIFIER_LENGTH);
const nonEmptyIdentifier = identifier.min(1);
const safeIndex = z
  .number()
  .refine((n) => Number.isSafeInteger(n) && n >= 0, 'expected a non-negative safe integer');
const revisionNumber = z
  .number()
  .refine((n) => Number.isSafeInteger(n) && n > 0, 'expected a positive safe integer');

/**
 * Limits are an ADDITIVE part of the contract: unknown keys are IGNORED, not
 * rejected. A driver that learns a new ceiling must not break every already
 * published adapter, so this is the one object on the wire read leniently.
 * Known keys stay strict about their type, and every closed set elsewhere
 * (message types, roles, actions, capabilities) stays strict too.
 */
const limitsSchema = z.object({
  maxFrameBytes: revisionNumber,
  maxSnapshotBytes: revisionNumber,
  maxNodes: revisionNumber,
  maxDepth: revisionNumber,
  maxStringBytes: revisionNumber,
  maxRelationTargets: revisionNumber,
  maxQueuedFrames: revisionNumber,
  maxPendingWaiters: revisionNumber,
  maxSessions: revisionNumber,
  maxLogRecordBytes: revisionNumber,
  maxLogQueue: revisionNumber,
});

const errorSchema = z.strictObject({
  type: z.literal('error'),
  code: z.enum(['bad-token', 'bad-version', 'malformed', 'limit-exceeded', 'internal']),
  message: z.string().max(MAX_IDENTIFIER_LENGTH),
});

/** adapter → driver schemas. Snapshot bodies are validated separately. */
const helloSchema = z.strictObject({
  type: z.literal('hello'),
  protocol: z.literal(PROTOCOL_ID),
  token: nonEmptyIdentifier,
  adapter: z.strictObject({ name: nonEmptyIdentifier, version: nonEmptyIdentifier }),
  capabilities: z.array(z.enum(ADAPTER_CAPABILITIES)).max(ADAPTER_CAPABILITIES.length),
});

const revisionCommitSchema = z.strictObject({
  type: z.literal('revision-commit'),
  revision: revisionNumber,
});

const snapshotEnvelopeSchema = z.strictObject({
  type: z.literal('snapshot'),
  snapshot: z.unknown(),
});

const logEnvelopeSchema = z.strictObject({
  type: z.literal('log'),
  record: z.unknown(),
});

const getTreeResultSchema = z
  .strictObject({
    type: z.literal('get-tree-result'),
    requestId: safeIndex,
    snapshot: z.unknown().optional(),
    error: z.string().max(MAX_IDENTIFIER_LENGTH).optional(),
  })
  .refine(
    (m) => (m.snapshot === undefined) !== (m.error === undefined),
    'exactly one of snapshot or error must be present',
  );

/** driver → adapter schemas. */
const helloAckSchema = z.strictObject({
  type: z.literal('hello-ack'),
  protocol: z.literal(PROTOCOL_ID),
  sessionId: nonEmptyIdentifier,
  limits: limitsSchema,
  subscribe: z.enum(['snapshots', 'revisions']),
  marker: z.strictObject({ enabled: z.boolean() }),
  logs: z
    .strictObject({
      enabled: z.boolean(),
      maxRecordsPerSecond: revisionNumber,
      burst: safeIndex,
    })
    .optional(),
});

const getTreeRequestSchema = z.strictObject({
  type: z.literal('get-tree'),
  requestId: safeIndex,
  revision: revisionNumber.optional(),
});

function malformed(detail: string): MessageParseResult<never> {
  return { ok: false, code: 'malformed', detail };
}

/** Projection guard shared by both parsers. */
function project(value: unknown, limits: ProtocolLimits): MessageParseResult<unknown> {
  try {
    return { ok: true, message: projectDto<unknown>(value, limits.maxDepth) };
  } catch (error) {
    const detail =
      error instanceof ProtocolViolation ? error.message : 'value is not a plain JSON DTO';
    return error instanceof ProtocolViolation && error.code === 'dto-depth'
      ? { ok: false, code: 'limit-exceeded', detail }
      : malformed(detail);
  }
}

function messageType(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const type: unknown = (value as { type?: unknown }).type;
  return typeof type === 'string' ? type : null;
}

function check(schema: z.ZodType, value: unknown): string | null {
  const result = schema.safeParse(value);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>';
  return `${where}: ${issue.message}`;
}

/**
 * Validate a snapshot carried inside an envelope and map its failure onto the
 * wire error taxonomy: capacity failures are `limit-exceeded`, the rest are
 * `malformed`.
 */
function checkSnapshot(value: unknown, limits: ProtocolLimits): MessageParseResult<never> | null {
  const result = validateSnapshot(value, limits);
  if (result.ok) return null;
  const overCapacity =
    result.code === 'bytes' ||
    result.code === 'count' ||
    result.code === 'depth' ||
    result.code === 'string-bytes';
  return {
    ok: false,
    code: overCapacity ? 'limit-exceeded' : 'malformed',
    detail: `snapshot ${result.code}: ${result.detail}`,
  };
}

/**
 * Validate a log record carried inside an envelope, mapping capacity failures
 * onto `limit-exceeded` exactly as snapshots do.
 */
function checkLogRecord(value: unknown, limits: ProtocolLimits): MessageParseResult<never> | null {
  const result = validateLogRecord(value, limits);
  if (result.ok) return null;
  const overCapacity =
    result.code === 'bytes' ||
    result.code === 'count' ||
    result.code === 'depth' ||
    result.code === 'string-bytes';
  return {
    ok: false,
    code: overCapacity ? 'limit-exceeded' : 'malformed',
    detail: `log record ${result.code}: ${result.detail}`,
  };
}

/**
 * Parse and validate one adapter → driver message.
 *
 * @param value - Untrusted decoded frame body.
 * @param limits - Active session limits, applied to any embedded snapshot.
 * @returns A frozen message on success, or a typed failure. Never throws.
 */
export function parseAdapterMessage(
  value: unknown,
  limits: ProtocolLimits,
): MessageParseResult<AdapterToDriverMessage> {
  const projected = project(value, limits);
  if (!projected.ok) return projected;
  const dto = projected.message;

  switch (messageType(dto)) {
    case 'hello': {
      const protocol: unknown = (dto as { protocol?: unknown }).protocol;
      if (typeof protocol === 'string' && protocol !== PROTOCOL_ID) {
        return { ok: false, code: 'bad-version', detail: `unsupported protocol ${protocol}` };
      }
      const issue = check(helloSchema, dto);
      return issue === null ? { ok: true, message: dto as HelloMessage } : malformed(issue);
    }
    case 'revision-commit': {
      const issue = check(revisionCommitSchema, dto);
      return issue === null
        ? { ok: true, message: dto as RevisionCommitMessage }
        : malformed(issue);
    }
    case 'snapshot': {
      const issue = check(snapshotEnvelopeSchema, dto);
      if (issue !== null) return malformed(issue);
      const bad = checkSnapshot((dto as { snapshot: unknown }).snapshot, limits);
      return bad ?? { ok: true, message: dto as SnapshotMessage };
    }
    case 'get-tree-result': {
      const issue = check(getTreeResultSchema, dto);
      if (issue !== null) return malformed(issue);
      const envelope = dto as { snapshot?: unknown };
      if (envelope.snapshot !== undefined) {
        const bad = checkSnapshot(envelope.snapshot, limits);
        if (bad !== null) return bad;
      }
      return { ok: true, message: dto as GetTreeResponse };
    }
    case 'log': {
      const issue = check(logEnvelopeSchema, dto);
      if (issue !== null) return malformed(issue);
      const bad = checkLogRecord((dto as { record: unknown }).record, limits);
      return bad ?? { ok: true, message: dto as LogMessage };
    }
    case 'error': {
      const issue = check(errorSchema, dto);
      return issue === null
        ? { ok: true, message: dto as ProtocolErrorMessage }
        : malformed(issue);
    }
    default:
      return malformed('unknown or missing message type');
  }
}

/**
 * Parse and validate one driver → adapter message.
 *
 * @param value - Untrusted decoded frame body.
 * @param limits - Active session limits used for the projection depth bound.
 * @returns A frozen message on success, or a typed failure. Never throws.
 */
export function parseDriverMessage(
  value: unknown,
  limits: ProtocolLimits,
): MessageParseResult<DriverToAdapterMessage> {
  const projected = project(value, limits);
  if (!projected.ok) return projected;
  const dto = projected.message;

  switch (messageType(dto)) {
    case 'hello-ack': {
      const protocol: unknown = (dto as { protocol?: unknown }).protocol;
      if (typeof protocol === 'string' && protocol !== PROTOCOL_ID) {
        return { ok: false, code: 'bad-version', detail: `unsupported protocol ${protocol}` };
      }
      const issue = check(helloAckSchema, dto);
      return issue === null ? { ok: true, message: dto as HelloAckMessage } : malformed(issue);
    }
    case 'get-tree': {
      const issue = check(getTreeRequestSchema, dto);
      return issue === null ? { ok: true, message: dto as GetTreeRequest } : malformed(issue);
    }
    case 'error': {
      const issue = check(errorSchema, dto);
      return issue === null
        ? { ok: true, message: dto as ProtocolErrorMessage }
        : malformed(issue);
    }
    default:
      return malformed('unknown or missing message type');
  }
}
