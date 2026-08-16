/**
 * The channel the fixtures use to hand trace archives to the reporter.
 *
 * Vitest serializes `task.meta` from the worker to the main process, which is
 * how a `.twtrace` directory written during teardown reaches the reporter that
 * renders the HTML report.
 *
 * It lives in its own module because both sides need the augmentation, and a
 * consumer that only imports `@termwright/test/reporter` must still get it:
 * without `TaskMeta` carrying `termwright`, Vitest's `File` is not assignable
 * to the reporter's structural view of a task, and
 * `reporters: [new TermwrightReporter()]` fails to typecheck.
 */

/**
 * Exported on purpose: a bare `export {}` does not survive the declaration
 * bundler, and a `.d.ts` with no imports or exports is a *script*, where
 * `declare module 'vitest'` declares a new ambient module that shadows the real
 * one instead of merging into it. A named export keeps the emitted file a
 * module, so the augmentation stays an augmentation.
 */
export interface TermwrightTaskMeta {
  /** Trace archives written for this test, in launch order. */
  readonly traces?: readonly string[];
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
   * message nobody sees on a passing run.
   */
  readonly lostLogRecords?: number;
}

import type { ReportCrash } from './crash.js';

/** Builds the metadata for a test, omitting everything it has nothing to say about. */
export function buildTaskMeta(parts: {
  readonly traces?: readonly string[];
  readonly obsoleteSnapshots?: readonly string[];
  readonly crashes?: readonly ReportCrash[];
  readonly lostLogRecords?: number;
}): TermwrightTaskMeta | undefined {
  const meta: Record<string, unknown> = {};
  if (parts.traces !== undefined && parts.traces.length > 0) meta['traces'] = [...parts.traces];
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
