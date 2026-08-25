/**
 * The per-test scope shared by fixtures and matchers.
 *
 * Matchers must reach the trace writers of the session the current test
 * launched without every matcher call being handed a writer. An
 * The exact-certified runner installs an `AsyncLocalStorage` boundary before
 * fixtures resolve and keeps it through cleanup. No authored title or file
 * path participates in identity.
 */

import type { GherkinStepMetadata, StepHandle, StepStatus, TraceWriter } from '@termwright/trace';
import { createRunId, type LocatorRef, type ObservationStamp, type StepId } from '@termwright/protocol';
import type { ResolvedTermwrightConfig } from './config.js';
import { currentAttemptContext, currentAttemptEventRecorder, currentAttemptRuntime } from './attempt-context.js';

/** A recorded assertion, mirroring `AssertEvent` without the trace bookkeeping. */
export interface AssertRecord {
  /** Matcher name, e.g. `toBeVisible`. */
  readonly api: string;
  readonly selector?: string;
  readonly ref?: LocatorRef;
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

interface ActiveStep {
  readonly id: StepId;
  readonly title: string;
  readonly metadata: { readonly stepId: string; readonly gherkin?: GherkinStepMetadata };
  readonly handles: StepHandle[];
}
const stepStacks = new WeakMap<TermwrightScope, ActiveStep[]>();

/**
 * Binds fixture services to the current native attempt.
 *
 * @returns a disposer; calling it twice is a no-op.
 */
export function enterScope(scope: TermwrightScope): () => void {
  const runtime = currentAttemptRuntime();
  if (runtime.scope !== undefined) throw new Error('the current Termwright attempt already has a fixture scope');
  runtime.scope = scope;
  let exited = false;
  return () => {
    if (exited) return;
    exited = true;
    if (runtime.scope === scope) runtime.scope = undefined;
  };
}

/**
 * The scope of a running test.
 *
 * There is deliberately no file/title lookup and no "most recently active"
 * fallback. Parallel tests may have identical titles; ALS is the authority.
 */
export function currentScope(): TermwrightScope | undefined {
  const scope = currentAttemptRuntime().scope;
  return scope as TermwrightScope | undefined;
}

/** Records an assertion into every trace the test is recording. */
export function recordAssert(record: AssertRecord): void {
  const scope = currentScope();
  if (scope === undefined) throw new Error('the current Termwright attempt has no fixture scope');
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
  // Read the attempt eagerly: this both fails closed outside the certified
  // runner and binds the step to the current native try's ALS boundary.
  currentAttemptContext();
  const attemptEvents = currentAttemptEventRecorder();
  const id = createRunId('step');
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
  attemptEvents.record({
    eventClass: 'authoritative',
    type: 'step.started',
    stepId: id,
    payload: {
      title,
      ...(metadata?.gherkin === undefined ? {} : {
        gherkin: JSON.parse(JSON.stringify(metadata.gherkin)),
      }),
    },
  });
  let ended = false;
  return {
    stepId: frame.id,
    end(status: StepStatus = 'passed', error?: string): void {
      if (ended) return;
      ended = true;
      const index = stack.indexOf(frame);
      if (index !== -1) stack.splice(index, 1);
      for (const handle of frame.handles) handle.end(status, error);
      attemptEvents.record({
        eventClass: 'authoritative',
        type: 'step.finished',
        stepId: id,
        phase: 'cleanup',
        payload: {
          status,
          ...(error === undefined ? {} : { error: error.slice(0, 16_384) }),
        },
      });
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
