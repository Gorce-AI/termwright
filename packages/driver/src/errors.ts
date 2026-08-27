/**
 * Typed driver errors. Every error crossing a package boundary is one of these
 * classes; the class names and {@link TermwrightErrorCode} values are normative
 * (see `api.ts` and CONTRACTS.md).
 */
import type { ActionabilityExplanation } from '@termwright/protocol';
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
  actionability?: ActionabilityExplanation;

  constructor(code: TermwrightErrorCode, message: string, diagnostics: ErrorDiagnostics) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.diagnostics = freezeDiagnostics(diagnostics);
  }

  /** Attach the exact failed planner evaluation; never recomputed after state changes. */
  withActionability(explanation: ActionabilityExplanation): this {
    this.actionability = explanation;
    return this;
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

/** The certified PTY backend accepted work and later reported a fatal failure. */
export class PtyBackendError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics, options?: ErrorOptions) {
    super('pty-backend-failed', message, diagnostics);
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** A revision-bound locator ref was used after its observation was superseded or evicted. */
export class StaleSnapshotError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('stale-snapshot', message, diagnostics);
  }
}

/** Strict-mode violation: a locator matched more than one node. */
export class AmbiguousLocatorError extends TermwrightError {
  constructor(
    message: string,
    candidates: readonly ResolvedTarget[],
    diagnostics: ErrorDiagnostics,
  ) {
    super('ambiguous-locator', message, { ...diagnostics, candidates });
  }
}

/** A semantic query was requested in a session with no semantic integration. */
export class SemanticCapabilityUnavailableError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('semantic-capability-unavailable', message, diagnostics);
  }
}

/** A semantic integration was explicitly required, but no probe completed negotiation. */
export class ProbeAttachFailedError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('probe-attach-failed', message, diagnostics);
  }
}

/** The negotiated session contract does not include a required capability. */
export class CapabilityUnavailableError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('capability-unavailable', message, diagnostics);
  }
}

/** The capability exists, but the target cannot currently satisfy the action. */
export class NotActionableError extends TermwrightError {
  /** Only these planner facts may become actionable on a later committed observation. */
  readonly transient: 'target-state' | 'pointer-region' | 'covered' | null;

  constructor(
    message: string,
    diagnostics: ErrorDiagnostics,
    transient: 'target-state' | 'pointer-region' | 'covered' | null = null,
  ) {
    super('not-actionable', message, diagnostics);
    this.transient = transient;
  }
}

/** The physical device exists, but the application has not enabled the required terminal mode. */
export class InputModeDisabledError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('input-mode-disabled', message, diagnostics);
  }
}

export class CapabilityProviderLostError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('capability-provider-lost', message, diagnostics);
  }
}

export class CapabilityProviderViolationError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('capability-provider-violation', message, diagnostics);
  }
}

/** Two authoritative producers supplied incompatible facts for one revision. */
export class EvidenceConflictError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('evidence-conflict', message, diagnostics);
  }
}

export class AdapterGuaranteeViolationError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('adapter-guarantee-violation', message, diagnostics);
  }
}

/** An application-authored stable identity was not unique in one committed tree. */
export class DuplicateSemanticKeyError extends TermwrightError {
  constructor(message: string, diagnostics: ErrorDiagnostics) {
    super('duplicate-semantic-key', message, diagnostics);
  }
}

/**
 * The requested physical action is impossible in the current session, e.g. a
 * click while the child never enabled mouse tracking, or a semantic query
 * without a semantic tree.
 */
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
