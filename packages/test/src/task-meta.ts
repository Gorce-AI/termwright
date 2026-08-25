/**
 * The channel fixtures use to attach terminal diagnostics to the native task.
 *
 * Vitest serializes `task.meta` from the worker to the main process, which is
 * how a `.twtrace` directory and cleanup diagnostics written during teardown
 * reach the exact-certified runner and Native Host. Human reporters are only
 * projections of that host-owned state; they do not own this channel.
 */

/**
 * Exported on purpose: a bare `export {}` does not survive the declaration
 * bundler, and a `.d.ts` with no imports or exports is a *script*, where
 * `declare module 'vitest'` declares a new ambient module that shadows the real
 * one instead of merging into it. A named export keeps the emitted file a
 * module, so the augmentation stays an augmentation.
 */
export interface TermwrightTaskMeta {
  /** Provider which declared this case, present before execution starts. */
  readonly provider?: import('@termwright/ui/provider').TermwrightProviderMarker;
  /** Original mode before Vitest applies file-global `.only` and name filters. */
  readonly declaration?: import('@termwright/ui/provider').TermwrightProviderDeclaration;
  /** Physical authoring location for a transformed provider-owned case. */
  readonly source?: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
  /** Provider-authored catalogue kind; consumers must not infer it from the title. */
  readonly kind?: 'test' | 'gherkin-scenario' | 'gherkin-outline-example';
  /** Provider-authored hierarchy above this case. */
  readonly ancestors?: readonly {
    readonly kind: 'feature' | 'rule';
    readonly title: string;
  }[];
  /** Provider-authored tags attached to this case. */
  readonly tags?: readonly string[];
  /** Trace archives written for this test, in launch order. */
  readonly traces?: readonly string[];
  /** Failed native-Vitest attempts, ordered and captured before each retry. */
  readonly attemptFailures?: readonly TermwrightAttemptFailure[];
  /**
   * Snapshot keys in this test's file that no declared test claims any more.
   * Carried by whichever test of the file ran first.
   */
  readonly obsoleteSnapshots?: readonly string[];
  /** Programs that died unexpectedly during this test. */
  readonly crashes?: readonly ReportCrash[];
  /**
   * Log records that never reached this test, summed over the session's
   * `log-dropped` diagnostics. Omitted when nothing was lost.
   *
   * A green test with records missing is not the same result as a green test
   * with all of them, and the difference is invisible in a pass count — which
   * is why it travels to reporters rather than living only in a failure
   * message nobody sees on a passing run. The host persists this fact and
   * human reporters may project it.
   */
  readonly lostLogRecords?: number;
}

export interface TermwrightAttemptFailure {
  readonly executionId: import('./attempt-context.js').ExecutionId;
  readonly attemptId: import('./attempt-context.js').AttemptId;
  readonly repeat: number;
  readonly retry: number;
  /** One-based retry number within the execution. */
  readonly attempt: number;
  readonly errors: readonly { readonly message: string; readonly stack?: string }[];
  readonly traceRefs?: readonly string[];
}

import type { ReportCrash } from './crash.js';

/** Builds the metadata for a test, omitting everything it has nothing to say about. */
export function buildTaskMeta(parts: {
  readonly traces?: readonly string[];
  readonly attemptFailures?: readonly TermwrightAttemptFailure[];
  readonly obsoleteSnapshots?: readonly string[];
  readonly crashes?: readonly ReportCrash[];
  readonly lostLogRecords?: number;
}): TermwrightTaskMeta | undefined {
  const meta: Record<string, unknown> = {};
  if (parts.traces !== undefined && parts.traces.length > 0) meta['traces'] = [...parts.traces];
  if (parts.attemptFailures !== undefined && parts.attemptFailures.length > 0) {
    meta['attemptFailures'] = parts.attemptFailures.map((failure) => ({
      ...failure,
      errors: failure.errors.map((error) => ({ ...error })),
      ...(failure.traceRefs === undefined ? {} : { traceRefs: [...failure.traceRefs] }),
    }));
  }
  if (parts.obsoleteSnapshots !== undefined && parts.obsoleteSnapshots.length > 0) {
    meta['obsoleteSnapshots'] = [...parts.obsoleteSnapshots];
  }
  if (parts.crashes !== undefined && parts.crashes.length > 0) meta['crashes'] = [...parts.crashes];
  if (parts.lostLogRecords !== undefined && parts.lostLogRecords > 0) {
    meta['lostLogRecords'] = parts.lostLogRecords;
  }
  return Object.keys(meta).length === 0 ? undefined : (meta as TermwrightTaskMeta);
}

declare module 'vitest' {
  interface TaskMeta {
    termwright?: TermwrightTaskMeta;
  }
};
