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
}

import type { ReportCrash } from './crash.js';

declare module 'vitest' {
  interface TaskMeta {
    termwright?: TermwrightTaskMeta;
  }
};
