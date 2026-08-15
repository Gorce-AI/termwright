/**
 * Error taxonomy shared by the tools and the CLI.
 *
 * Driver failures arrive as `TermwrightError` and keep their `code` verbatim —
 * a `stale-snapshot` on a reused `n8@42` ref reaches the agent as
 * `kind: "stale-snapshot"`, not as a stack trace. The server adds three kinds of
 * its own for failures that never reach the driver: bad arguments, unknown
 * terminal handles, and internal faults.
 */
import { TermwrightError } from '@termwright/driver';

/** Kinds an agent can branch on. Superset of `TermwrightErrorCode`. */
export type ErrorKind =
  | 'timeout'
  | 'stale-snapshot'
  | 'ambiguous-locator'
  | 'unsupported-action'
  | 'history-truncated'
  | 'protocol-violation'
  | 'capacity'
  | 'process-exited'
  | 'session-closed'
  | 'usage'
  | 'no-session'
  | 'internal';

/** CLI exit codes (CONTRACTS.md §MCP). */
export const EXIT_CODES = Object.freeze({
  ok: 0,
  assertion: 1,
  usage: 2,
  noSession: 3,
  ipc: 4,
  internal: 5,
});

/** Exit code for a failure of the given kind. */
export function exitCodeFor(kind: ErrorKind): number {
  switch (kind) {
    case 'usage':
      return EXIT_CODES.usage;
    case 'no-session':
    case 'session-closed':
      return EXIT_CODES.noSession;
    case 'protocol-violation':
      return EXIT_CODES.ipc;
    case 'internal':
      return EXIT_CODES.internal;
    default:
      return EXIT_CODES.assertion;
  }
}

/**
 * A failure raised by the MCP layer itself (argument validation, unknown
 * terminal handle, capacity). Structurally identical to `TermwrightError`
 * (`kind` + `suggestion`) but with a wider kind domain; it never crosses a
 * package boundary, so it does not need to be a `TermwrightError` subclass.
 */
export class McpError extends Error {
  readonly kind: ErrorKind;
  readonly suggestion: string | undefined;

  constructor(kind: ErrorKind, message: string, suggestion?: string) {
    super(message);
    this.name = 'McpError';
    this.kind = kind;
    this.suggestion = suggestion;
  }
}

/** Bad or contradictory tool arguments — exit code 2. */
export function usageError(message: string, suggestion?: string): McpError {
  return new McpError('usage', message, suggestion);
}

/** Unknown or already-closed terminal handle — exit code 3. */
export function noSessionError(message: string, suggestion?: string): McpError {
  return new McpError('no-session', message, suggestion);
}

/** The agent-facing projection of a failure. */
export interface ErrorPayload {
  readonly kind: ErrorKind;
  readonly message: string;
  readonly suggestion?: string;
  readonly semanticTree?: boolean;
  readonly candidates?: readonly string[];
  readonly screenExcerpt?: string;
}

const MAX_CANDIDATES = 10;
const MAX_EXCERPT_CHARS = 2_000;

/**
 * Projects any thrown value into an {@link ErrorPayload}. Driver diagnostics
 * (candidates, screen excerpt, suggestion) are carried over — bounded — because
 * they are what lets an agent fix its own next call. Stack traces are dropped.
 */
export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof TermwrightError) {
    const diagnostics = error.diagnostics;
    const candidates = diagnostics.candidates?.slice(0, MAX_CANDIDATES).map((candidate) => {
      const role = candidate.role ?? 'generic';
      const name = candidate.name === undefined ? '' : ` ${JSON.stringify(candidate.name)}`;
      return `${role}${name} ref=${candidate.ref}`;
    });
    return {
      kind: error.code,
      message: error.message,
      ...(diagnostics.suggestion === undefined ? {} : { suggestion: diagnostics.suggestion }),
      semanticTree: diagnostics.semanticTree,
      ...(candidates === undefined || candidates.length === 0 ? {} : { candidates }),
      ...(diagnostics.screenExcerpt === undefined
        ? {}
        : { screenExcerpt: diagnostics.screenExcerpt.slice(0, MAX_EXCERPT_CHARS) }),
    };
  }
  if (error instanceof McpError) {
    return {
      kind: error.kind,
      message: error.message,
      ...(error.suggestion === undefined ? {} : { suggestion: error.suggestion }),
    };
  }
  return { kind: 'internal', message: error instanceof Error ? error.message : String(error) };
}

/** Renders an {@link ErrorPayload} the way a tool result's text content shows it. */
export function renderErrorPayload(payload: ErrorPayload): string {
  const parts = [`error ${payload.kind}: ${payload.message}`];
  if (payload.suggestion !== undefined) parts.push(`suggestion: ${payload.suggestion}`);
  if (payload.semanticTree !== undefined) parts.push(`semanticTree: ${payload.semanticTree}`);
  if (payload.candidates !== undefined) {
    parts.push(`candidates:\n${payload.candidates.map((candidate) => `  - ${candidate}`).join('\n')}`);
  }
  if (payload.screenExcerpt !== undefined) parts.push(`screen:\n${payload.screenExcerpt}`);
  return parts.join('\n');
}
