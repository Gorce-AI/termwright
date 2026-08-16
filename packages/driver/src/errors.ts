/**
 * Typed driver errors. Every error crossing a package boundary is one of these
 * classes; the class names and {@link TermwrightErrorCode} values are normative
 * (see `api.ts` and CONTRACTS.md).
 */
import type { ErrorDiagnostics, ResolvedTarget, TermwrightErrorCode } from './api.js';

/** Diagnostics with all optional parts omitted rather than set to `undefined`. */
function freezeDiagnostics(diagnostics: ErrorDiagnostics): ErrorDiagnostics {
  return Object.freeze({ ...diagnostics });
}

/**
 * Base class for every error the driver throws. Carries a stable {@link code}
 * plus Playwright-grade {@link diagnostics} (what was observed, which
 * candidates existed, and a suggestion).
 */
export class TermwrightError extends Error {
  readonly code: TermwrightErrorCode;
  readonly diagnostics: ErrorDiagnostics;

  constructor(code: TermwrightErrorCode, message: string, diagnostics: ErrorDiagnostics) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.diagnostics = freezeDiagnostics(diagnostics);
  }

  /** Renders message + diagnostics the way test runners print failures. */
  override toString(): string {
    const parts = [`${this.name}: ${this.message}`];
    if (this.diagnostics.suggestion !== undefined) {
      parts.push(`suggestion: ${this.diagnostics.suggestion}`);
    }
    parts.push(`semanticTree: ${this.diagnostics.semanticTree}`);
    if (this.diagnostics.candidates !== undefined && this.diagnostics.candidates.length > 0) {
      const lines = this.diagnostics.candidates.map(
        (c) => `  - ${c.role ?? 'generic'} ${JSON.stringify(c.name ?? '')} ref=${c.ref}`,
      );
      parts.push(`candidates:\n${lines.join('\n')}`);
    }
    if (this.diagnostics.screenExcerpt !== undefined) {
      parts.push(`screen:\n${this.diagnostics.screenExcerpt}`);
    }
    return parts.join('\n');
  }
}

/** A bounded wait (locator resolution, text/render/idle/exit wait) ran out. */
export class TimeoutError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('timeout', message, diagnostics);
  }
}

/** A ref (`n8@42`) was used after its revision was superseded or evicted. */
export class StaleSnapshotError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('stale-snapshot', message, diagnostics);
  }
}

/** Strict-mode violation: a locator matched more than one node. */
export class AmbiguousLocatorError extends TermwrightError {
  constructor(message: string, candidates: readonly ResolvedTarget[], diagnostics: ErrorDiagnostics) {
    super('ambiguous-locator', message, { ...diagnostics, candidates });
  }
}

/**
 * The requested physical action is impossible in the current session, e.g. a
 * click while the child never enabled mouse tracking, or a semantic query
 * without a semantic tree.
 */
export class UnsupportedActionError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('unsupported-action', message, diagnostics);
  }
}

/** Scrollback data was requested below the retained floor. */
export class HistoryTruncatedError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('history-truncated', message, diagnostics);
  }
}

/** The adapter violated the semantic protocol; its channel was closed. */
export class ProtocolViolationError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('protocol-violation', message, diagnostics);
  }
}

/** A bounded resource (queued frames, pending waiters, sessions) is exhausted. */
export class CapacityError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('capacity', message, diagnostics);
  }
}

/** The child process exited before the awaited condition could be satisfied. */
export class ProcessExitedError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('process-exited', message, diagnostics);
  }
}

/** The harness was closed; no further observation or input is possible. */
export class SessionClosedError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('session-closed', message, diagnostics);
  }
}

/**
 * A named resource does not exist. Reserved for absence, never for a resource
 * that is present and wrong — that is a `protocol-violation`.
 */
export class NotFoundError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('not-found', message, diagnostics);
  }
}

/** Diagnostics for a session that never negotiated a semantic tree. */
export const GENERIC_DIAGNOSTICS: ErrorDiagnostics = Object.freeze({ semanticTree: false });
