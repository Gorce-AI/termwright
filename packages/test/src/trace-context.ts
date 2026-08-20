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

import type { GherkinStepMetadata, StepHandle, StepStatus, TraceWriter } from '@termwright/trace';
import type { ObservationStamp } from '@termwright/protocol';
import type { ResolvedTermwrightConfig } from './config.js';

/** A recorded assertion, mirroring `AssertEvent` without the trace bookkeeping. */
export interface AssertRecord {
  /** Matcher name, e.g. `toBeVisible`. */
  readonly api: string;
  readonly selector?: string;
  readonly ref?: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly observation?: ObservationStamp;
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
interface ActiveStep {
  readonly id: string;
  readonly title: string;
  readonly metadata: { readonly stepId: string; readonly gherkin?: GherkinStepMetadata };
  readonly handles: StepHandle[];
}
const stepStacks = new WeakMap<TermwrightScope, ActiveStep[]>();
const stepCounters = new WeakMap<TermwrightScope, number>();

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
      ...(record.observation === undefined ? {} : { observation: record.observation }),
    });
  }
}

/** Opens a step in every active trace of a scope; the handles close together. */
export function openStep(title: string, scope = currentScope()): StepHandle[] {
  if (scope === undefined) return [];
  return scope.writers.map((writer) => writer.addStep(title));
}

/** Opens a scope-owned step, including on writers launched while it is active. */
export function beginStep(
  title: string,
  metadata?: { readonly gherkin?: GherkinStepMetadata },
  scope = currentScope(),
): { readonly stepId?: string; end(status?: StepStatus, error?: string): void } {
  if (scope === undefined) return { end: () => undefined };
  const next = (stepCounters.get(scope) ?? 0) + 1;
  stepCounters.set(scope, next);
  const id = `tw-step-${next}`;
  const writerMetadata = { stepId: id, ...(metadata?.gherkin === undefined ? {} : { gherkin: metadata.gherkin }) };
  const frame: ActiveStep = {
    id,
    title,
    metadata: writerMetadata,
    handles: scope.writers.map((writer) => writer.addStep(title, writerMetadata)),
  };
  const stack = stepStacks.get(scope) ?? [];
  stack.push(frame);
  stepStacks.set(scope, stack);
  let ended = false;
  return {
    stepId: frame.id,
    end(status: StepStatus = 'passed', error?: string): void {
      if (ended) return;
      ended = true;
      const index = stack.indexOf(frame);
      if (index !== -1) stack.splice(index, 1);
      for (const handle of frame.handles) handle.end(status, error);
    },
  };
}

/** Registers a new trace writer and re-opens steps that began before launch. */
export function attachWriter(scope: TermwrightScope | undefined, writer: TraceWriter): void {
  if (scope === undefined) return;
  scope.writers.push(writer);
  for (const frame of stepStacks.get(scope) ?? []) {
    frame.handles.push(writer.addStep(frame.title, frame.metadata));
  }
}

/** External live-wire id of the innermost authored step. */
export function currentStepId(scope: TermwrightScope | undefined): string | undefined {
  return scope === undefined ? undefined : stepStacks.get(scope)?.at(-1)?.id;
}
