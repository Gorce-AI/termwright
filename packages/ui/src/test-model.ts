/**
 * The test list, as data: grouping, filtering, counting and elapsed time.
 *
 * Kept out of `src/app/` so it can be tested without a DOM — the panel that
 * renders it is a thin function over these results.
 *
 * @packageDocumentation
 */

import type { UiTestStatus } from './events.js';

/** A test as the list shows it. */
export interface TestRow {
  readonly id: string;
  readonly title: string;
  readonly file?: string;
  /** `running` until the test ends. */
  readonly status: UiTestStatus | 'running';
  /** Wall-clock start, for the elapsed time of a running test. */
  readonly startedAt?: number;
  /** Final duration, reported when the test ended. */
  readonly durationMs?: number;
  /** Passed only after a retry. */
  readonly flaky?: boolean;
  readonly error?: string;
  readonly traceRef?: string;
  /** Session the test drives, when the producer reported one. */
  readonly sessionId?: string;
}

/** Tests of one file, in report order. */
export interface TestGroup {
  /** Absolute path, or `undefined` for tests whose producer reported no file. */
  readonly file?: string;
  /** Path shortened for display: the last two segments. */
  readonly label: string;
  readonly tests: readonly TestRow[];
}

/** What the header shows. */
export interface TestCounts {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly flaky: number;
  readonly running: number;
}

/**
 * Filters by a plain substring over title and file, case-insensitively.
 *
 * Deliberately not a regex or a glob: a search box that throws on `(` is worse
 * than one that matches less.
 */
export function filterTests(tests: readonly TestRow[], query: string): readonly TestRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return tests;
  return tests.filter(
    (test) =>
      test.title.toLowerCase().includes(needle) || (test.file ?? '').toLowerCase().includes(needle),
  );
}

/** Groups tests by file, keeping both files and tests in first-seen order. */
export function groupTests(tests: readonly TestRow[]): readonly TestGroup[] {
  const groups = new Map<string, TestRow[]>();
  for (const test of tests) {
    const key = test.file ?? '';
    const list = groups.get(key) ?? [];
    list.push(test);
    groups.set(key, list);
  }
  return [...groups].map(([file, list]) => ({
    ...(file === '' ? {} : { file }),
    label: file === '' ? 'no file' : shortenPath(file),
    tests: list,
  }));
}

/** Counts for the header. `flaky` overlaps `passed`, as it does in Vitest. */
export function countTests(tests: readonly TestRow[]): TestCounts {
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, running: 0 };
  for (const test of tests) {
    counts.total += 1;
    if (test.status === 'running') counts.running += 1;
    else counts[test.status] += 1;
    if (test.flaky === true) counts.flaky += 1;
  }
  return counts;
}

/**
 * How long a test took, or has been running.
 *
 * @param now - current epoch milliseconds, injected so the caller controls the
 * clock (and so this is testable).
 * @returns the duration in milliseconds, or `null` when neither a duration nor
 * a start time is known — better to show nothing than to show `0ms` for a test
 * whose producer never reported either.
 */
export function testDuration(test: TestRow, now: number): number | null {
  if (test.durationMs !== undefined) return test.durationMs;
  if (test.status === 'running' && test.startedAt !== undefined) {
    return Math.max(now - test.startedAt, 0);
  }
  return null;
}

/** The last two path segments: `login/basic.test.ts`. */
export function shortenPath(file: string): string {
  const parts = file.split(/[/\\]/).filter((part) => part !== '');
  return parts.slice(-2).join('/');
}

/** A one-line summary of a run, as the footer states it. */
export function describeCounts(counts: TestCounts): string {
  const parts = [`${counts.total} tests`, `${counts.passed} passed`, `${counts.failed} failed`];
  if (counts.flaky > 0) parts.push(`${counts.flaky} flaky`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  if (counts.running > 0) parts.push(`${counts.running} running`);
  return parts.join(', ');
}
