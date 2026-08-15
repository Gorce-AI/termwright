/**
 * The per-test scope shared by fixtures and matchers.
 *
 * Matchers must reach the trace writers of the session the current test
 * launched without every matcher call being handed a writer. An
 * `AsyncLocalStorage` would be the natural carrier, but Vitest resolves fixture
 * `use()` from its own async context, so the store is invisible inside the test
 * body. Scopes are therefore registered in a small registry keyed by test file
 * and full test name — the same pair `expect.getState()` reports — which stays
 * correct for concurrent tests instead of guessing.
 */

import type { StepHandle, TraceWriter } from '@termwright/trace';
import type { ResolvedTermwrightConfig } from './config.js';

/** A recorded assertion, mirroring `AssertEvent` without the trace bookkeeping. */
export interface AssertRecord {
  /** Matcher name, e.g. `toBeVisible`. */
  readonly api: string;
  readonly selector?: string;
  readonly ref?: string;
  readonly ok: boolean;
  readonly error?: string;
}

/** What a running test exposes to matchers and helpers. */
export interface TermwrightScope {
  readonly testId: string;
  /** Full name including suites, joined with ` > `. */
  readonly testName: string;
  readonly testFile: string;
  readonly config: ResolvedTermwrightConfig;
  /** One writer per session launched by this test; empty when tracing is off. */
  readonly writers: TraceWriter[];
  /** Trace archive directories kept after the test, filled in on teardown. */
  readonly traces: string[];
}

const active: TermwrightScope[] = [];
const byKey = new Map<string, TermwrightScope>();

/** The registry key for a test: its file and its full name. */
export function scopeKey(testFile: string, testName: string): string {
  return `${testFile}::${testName}`;
}

/**
 * Registers a scope for the duration of a test.
 *
 * @returns a disposer; calling it twice is a no-op.
 */
export function enterScope(scope: TermwrightScope): () => void {
  const key = scopeKey(scope.testFile, scope.testName);
  active.push(scope);
  byKey.set(key, scope);
  let exited = false;
  return () => {
    if (exited) return;
    exited = true;
    const index = active.indexOf(scope);
    if (index !== -1) active.splice(index, 1);
    if (byKey.get(key) === scope) byKey.delete(key);
  };
}

/**
 * The scope of a running test.
 *
 * @param key - {@link scopeKey} of the test asking. Without it — or when the
 * key is unknown, which happens outside these fixtures — the most recently
 * started test is used.
 */
export function currentScope(key?: string): TermwrightScope | undefined {
  if (key !== undefined) {
    const found = byKey.get(key);
    if (found !== undefined) return found;
  }
  return active[active.length - 1];
}

/** Records an assertion into every trace the test is recording. */
export function recordAssert(record: AssertRecord, key?: string): void {
  const scope = currentScope(key);
  if (scope === undefined) return;
  for (const writer of scope.writers) {
    writer.recordAssert({
      api: record.api,
      ok: record.ok,
      ...(record.selector === undefined ? {} : { selector: record.selector }),
      ...(record.ref === undefined ? {} : { ref: record.ref }),
      ...(record.error === undefined ? {} : { error: record.error }),
    });
  }
}

/** Opens a step in every active trace of a scope; the handles close together. */
export function openStep(title: string, scope = currentScope()): StepHandle[] {
  if (scope === undefined) return [];
  return scope.writers.map((writer) => writer.addStep(title));
}
