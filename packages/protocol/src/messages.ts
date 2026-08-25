import { z } from "zod";
import type { SemanticSnapshot } from "./tree.js";
import type { LogRecord } from "./logs.js";
import type { ProbeInfo } from "./probe/ir.js";
import type { ProtocolLimits } from "./limits.js";
import { PROTOCOL_ID, type ProtocolId } from "./env.js";
import { ProtocolViolation } from "./errors.js";
import { projectDto } from "./framing.js";
import { validateSnapshot } from "./validate.js";
import { validateLogRecord } from "./logs.js";
import { probeInfoSchema, validateProbeInfo } from "./probe/validate.js";
import {
  ADAPTER_CAPABILITIES,
  EVIDENCE_PROVIDER_CAPABILITIES,
  type AdapterCapability,
  type EvidenceProviderRegistration,
} from "./contract.js";

/**
 * Wire messages. Transport: length-prefixed JSON frames (see framing.ts).
 * CDP-like: adapter pushes commits; driver issues requests; either side may
 * send errors. All messages are validated against limits BEFORE retention.
 */

export { ADAPTER_CAPABILITIES } from "./contract.js";
export type { AdapterCapability } from "./contract.js";

/** adapter → driver, exactly once, before any other message. */
export interface HelloMessage {
  readonly type: "hello";
  readonly protocol: ProtocolId;
  readonly token: string;
  readonly adapter: { readonly name: string; readonly version: string };
  readonly capabilities: readonly AdapterCapability[];
  /**
   * Present when the sender is a probe rather than a hand-written adapter.
   *
   * Carries what the probe can actually offer — framework and versions, the
   * best identity it can produce, and its optional abilities — so the driver
   * negotiates against measured capability rather than assuming a floor.
   */
  readonly probe?: ProbeInfo;
  /** Application evidence providers frozen into this session contract. */
  readonly providers?: readonly EvidenceProviderRegistration[];
}

/** driver → adapter, reply to hello. */
export interface HelloAckMessage {
  readonly type: "hello-ack";
  readonly protocol: ProtocolId;
  readonly sessionId: string;
  readonly limits: ProtocolLimits;
  /** Which semantic traffic the driver wants pushed. */
  readonly subscribe: "snapshots" | "revisions";
  /** Marker configuration: producer must emit the signed OSC 8487 commit marker. */
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
  readonly type: "revision-commit";
  readonly revision: number;
}

/** adapter → driver, full snapshot for a revision (subscribe: 'snapshots'). */
export interface SnapshotMessage {
  readonly type: "snapshot";
  readonly snapshot: SemanticSnapshot;
}

/**
 * adapter → driver, a frame has started (capability `frame-begin`).
 *
 * **Optional, and its absence means nothing.** No audited framework offers a
 * hook guaranteed to fire before every frame: one lets a pre-draw hook veto the
 * frame entirely, so the post-draw hook never runs; one exposes only a
 * post-frame hook; one decouples submission from the flush with a ticker. A
 * receiver that reads "no frame-begin" as "no frame in progress" turns four of
 * the six frameworks into a hang rather than an error.
 *
 * `FRAME_END` is the existing `revision-commit`, which stays advisory.
 *
 * **Abandoned frames**: a probe may begin a frame and never finish it — a
 * crash, an interrupted render. A `frame-begin` for revision N implicitly
 * closes every frame below N. Without that rule an open frame waits forever,
 * which is the timeout it replaced, only now wearing a false air of precision.
 */
export interface FrameBeginMessage {
  readonly type: "frame-begin";
  readonly revision: number;
}

/**
 * adapter → driver, one application log record (capability `logs`).
 *
 * Sent only after the driver enabled logs in `hello-ack`. Records are
 * independent of renders: they are not paired with a revision and never gate
 * snapshot publication.
 */
export interface LogMessage {
  readonly type: "log";
  readonly record: LogRecord;
}

/** either direction: terminal protocol error; sender closes after emitting. */
export interface ProtocolErrorMessage {
  readonly type: "error";
  readonly code:
    | "bad-token"
    | "bad-version"
    | "malformed"
    | "limit-exceeded"
    | "duplicate-semantic-key"
    | "adapter-guarantee-violation"
    | "capability-provider-violation"
    | "internal";
  readonly message: string;
}

export type AdapterToDriverMessage =
  | HelloMessage
  | RevisionCommitMessage
  | SnapshotMessage
  | FrameBeginMessage
  | LogMessage
  | ProtocolErrorMessage;

export type DriverToAdapterMessage = HelloAckMessage | ProtocolErrorMessage;

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
      readonly code:
        | "bad-version"
        | "malformed"
        | "limit-exceeded"
        | "capability-provider-violation";
      readonly detail: string;
    };

/** Longest token/identifier/message string accepted, in UTF-16 code units. */
const MAX_IDENTIFIER_LENGTH = 1024;

const identifier = z.string().max(MAX_IDENTIFIER_LENGTH);
const nonEmptyIdentifier = identifier.min(1);
const safeIndex = z
  .number()
  .refine(
    (n) => Number.isSafeInteger(n) && n >= 0,
    "expected a non-negative safe integer",
  );
const revisionNumber = z
  .number()
  .refine(
    (n) => Number.isSafeInteger(n) && n > 0,
    "expected a positive safe integer",
  );

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

const errorFields = {
  type: z.literal("error"),
  code: z.enum([
    "bad-token",
    "bad-version",
    "malformed",
    "limit-exceeded",
    "duplicate-semantic-key",
    "adapter-guarantee-violation",
    "capability-provider-violation",
    "internal",
  ]),
  message: z.string().max(MAX_IDENTIFIER_LENGTH),
};

/** adapter → driver: strict, this is the hostile-input boundary. */
const errorSchema = z.strictObject(errorFields);

/** driver → adapter: tolerant envelope, see the note above `parseDriverMessage`. */
const errorFromDriverSchema = z.object(errorFields);

/** adapter → driver schemas. Snapshot bodies are validated separately. */
const helloSchema = z.strictObject({
  type: z.literal("hello"),
  protocol: z.literal(PROTOCOL_ID),
  token: nonEmptyIdentifier,
  adapter: z.strictObject({
    name: nonEmptyIdentifier,
    version: nonEmptyIdentifier,
  }),
  capabilities: z
    .array(z.enum(ADAPTER_CAPABILITIES))
    .max(ADAPTER_CAPABILITIES.length),
  probe: probeInfoSchema.optional(),
  providers: z
    .array(
      z.strictObject({
        id: nonEmptyIdentifier,
        version: nonEmptyIdentifier,
        method: z.enum(["native", "declared"]),
        capabilities: z
          .array(z.enum(EVIDENCE_PROVIDER_CAPABILITIES))
          .min(1)
          .max(EVIDENCE_PROVIDER_CAPABILITIES.length)
          .refine(
            (values) => new Set(values).size === values.length,
            "provider capabilities must be unique",
          ),
      }),
    )
    .max(64)
    .superRefine((providers, ctx) => {
      const ids = new Set<string>();
      for (let index = 0; index < providers.length; index += 1) {
        const provider = providers[index]!;
        const id = provider.id;
        if (ids.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "id"],
            message: `duplicate provider id ${id}`,
          });
          return;
        }
        ids.add(id);
      }
    })
    .optional(),
});

const frameBeginSchema = z.strictObject({
  type: z.literal("frame-begin"),
  revision: revisionNumber,
});

const revisionCommitSchema = z.strictObject({
  type: z.literal("revision-commit"),
  revision: revisionNumber,
});

const snapshotEnvelopeSchema = z.strictObject({
  type: z.literal("snapshot"),
  snapshot: z.unknown(),
});

const logEnvelopeSchema = z.strictObject({
  type: z.literal("log"),
  record: z.unknown(),
});

/** driver → adapter schemas. */
const helloAckSchema = z.object({
  type: z.literal("hello-ack"),
  protocol: z.literal(PROTOCOL_ID),
  sessionId: nonEmptyIdentifier,
  limits: limitsSchema,
  subscribe: z.enum(["snapshots", "revisions"]),
  marker: z.object({ enabled: z.boolean() }),
  logs: z
    .object({
      enabled: z.boolean(),
      maxRecordsPerSecond: revisionNumber,
      burst: safeIndex,
    })
    .optional(),
});

function malformed(detail: string): MessageParseResult<never> {
  return { ok: false, code: "malformed", detail };
}

/** Projection guard shared by both parsers. */
function project(
  value: unknown,
  limits: ProtocolLimits,
): MessageParseResult<unknown> {
  try {
    return { ok: true, message: projectDto<unknown>(value, limits.maxDepth) };
  } catch (error) {
    const detail =
      error instanceof ProtocolViolation
        ? error.message
        : "value is not a plain JSON DTO";
    return error instanceof ProtocolViolation && error.code === "dto-depth"
      ? { ok: false, code: "limit-exceeded", detail }
      : malformed(detail);
  }
}

function messageType(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const type: unknown = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

function check(schema: z.ZodType, value: unknown): string | null {
  const result = schema.safeParse(value);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  const where =
    issue.path.length > 0 ? issue.path.map(String).join(".") : "<root>";
  return `${where}: ${issue.message}`;
}

/**
 * Validate a snapshot carried inside an envelope and map its failure onto the
 * wire error taxonomy: capacity failures are `limit-exceeded`; evidence-frame
 * contract failures retain their typed provider classification; the rest are
 * `malformed`.
 */
function checkSnapshot(
  value: unknown,
  limits: ProtocolLimits,
): MessageParseResult<never> | null {
  const result = validateSnapshot(value, limits);
  if (result.ok) return null;
  const overCapacity =
    result.code === "bytes" ||
    result.code === "count" ||
    result.code === "depth" ||
    result.code === "string-bytes";
  return {
    ok: false,
    code: overCapacity
      ? "limit-exceeded"
      : result.code === "provider"
        ? "capability-provider-violation"
        : "malformed",
    detail: `snapshot ${result.code}: ${result.detail}`,
  };
}

/**
 * Validate a log record carried inside an envelope, mapping capacity failures
 * onto `limit-exceeded` exactly as snapshots do.
 */
function checkLogRecord(
  value: unknown,
  limits: ProtocolLimits,
): MessageParseResult<never> | null {
  const result = validateLogRecord(value, limits);
  if (result.ok) return null;
  const overCapacity =
    result.code === "bytes" ||
    result.code === "count" ||
    result.code === "depth" ||
    result.code === "string-bytes";
  return {
    ok: false,
    code: overCapacity ? "limit-exceeded" : "malformed",
    detail: `log record ${result.code}: ${result.detail}`,
  };
}

/**
 * Parse and validate one adapter → driver message.
 *
 * **Strict reader**: this is the hostile-input boundary, so unknown fields are
 * rejected rather than ignored. See {@link parseDriverMessage} for why the
 * other direction is tolerant.
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
    case "hello": {
      const protocol: unknown = (dto as { protocol?: unknown }).protocol;
      if (typeof protocol === "string" && protocol !== PROTOCOL_ID) {
        return {
          ok: false,
          code: "bad-version",
          detail: `unsupported protocol ${protocol}`,
        };
      }
      const issue = check(helloSchema, dto);
      if (issue !== null) return malformed(issue);
      // The shape check cannot see the one incoherent pair: a probe declaring
      // frame-local identity while claiming it can be correlated across
      // frames. That rule has to hold on the wire, not only when a caller
      // remembers to run the helper.
      const probe = (dto as { probe?: unknown }).probe;
      if (probe !== undefined) {
        const checked = validateProbeInfo(probe);
        if (!checked.ok) return malformed(`probe: ${checked.detail}`);
      }
      return { ok: true, message: dto as HelloMessage };
    }
    case "revision-commit": {
      const issue = check(revisionCommitSchema, dto);
      return issue === null
        ? { ok: true, message: dto as RevisionCommitMessage }
        : malformed(issue);
    }
    case "snapshot": {
      const issue = check(snapshotEnvelopeSchema, dto);
      if (issue !== null) return malformed(issue);
      const bad = checkSnapshot(
        (dto as { snapshot: unknown }).snapshot,
        limits,
      );
      return bad ?? { ok: true, message: dto as SnapshotMessage };
    }
    case "frame-begin": {
      const issue = check(frameBeginSchema, dto);
      return issue === null
        ? { ok: true, message: dto as FrameBeginMessage }
        : malformed(issue);
    }
    case "log": {
      const issue = check(logEnvelopeSchema, dto);
      if (issue !== null) return malformed(issue);
      const bad = checkLogRecord((dto as { record: unknown }).record, limits);
      return bad ?? { ok: true, message: dto as LogMessage };
    }
    case "error": {
      const issue = check(errorSchema, dto);
      return issue === null
        ? { ok: true, message: dto as ProtocolErrorMessage }
        : malformed(issue);
    }
    default:
      return malformed("unknown or missing message type");
  }
}

/**
 * Parse and validate one driver → adapter message.
 *
 * **Tolerant reader.** Unlike {@link parseAdapterMessage}, unknown envelope
 * fields are ignored rather than rejected, and are carried through to the
 * caller so a reader that does understand them still can. Known fields stay
 * strictly type-checked, and closed sets (`type`, `code`, `subscribe`) stay
 * closed — an unknown message type is still `malformed`.
 *
 * The asymmetry is about who is speaking, not about the message. The driver is
 * the trusted party and behaviour is governed by negotiated capabilities, so a
 * newer driver may add an optional field without invalidating every adapter
 * already published. Traffic in the other direction crosses the hostile-input
 * boundary and stays strict.
 *
 * @param value - Decoded frame body from the driver.
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
    case "hello-ack": {
      const protocol: unknown = (dto as { protocol?: unknown }).protocol;
      if (typeof protocol === "string" && protocol !== PROTOCOL_ID) {
        return {
          ok: false,
          code: "bad-version",
          detail: `unsupported protocol ${protocol}`,
        };
      }
      const issue = check(helloAckSchema, dto);
      return issue === null
        ? { ok: true, message: dto as HelloAckMessage }
        : malformed(issue);
    }
    case "error": {
      const issue = check(errorFromDriverSchema, dto);
      return issue === null
        ? { ok: true, message: dto as ProtocolErrorMessage }
        : malformed(issue);
    }
    default:
      return malformed("unknown or missing message type");
  }
}
