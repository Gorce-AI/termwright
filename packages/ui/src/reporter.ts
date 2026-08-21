/**
 * The Vitest bridge: a reporter that translates a run into `§UI events` and
 * publishes them to a running `termwright ui` server.
 *
 * It is a *reporter*, not an integration: it reads the reported task objects
 * structurally and never imports Vitest, so the browser app — and this package —
 * stay independent of Vitest's internals, exactly as the contract requires.
 *
 * When `TERMWRIGHT_UI_URL` is not set the reporter does nothing at all, so it is
 * safe to leave configured in a repository where most runs are headless.
 *
 * @example
 * ```ts
 * // vitest.config.ts
 * import TermwrightUiReporter from '@termwright/ui/reporter';
 *
 * export default defineConfig({
 *   test: { reporters: ['default', new TermwrightUiReporter()] },
 * });
 * ```
 *
 * @packageDocumentation
 */

import { openTrace } from '@termwright/trace';
import {
  DEFAULT_RUNS_DIR,
  RUN_MANIFEST_VERSION,
  runId,
  writeRunManifest,
  type RunTestAttempt,
  type RunTest,
} from './runs.js';
import { readRunGit } from './project.js';
import { encodeMessage, type ServerMessage, type UiRunSummary, type UiTestStatus } from './events.js';
import { canonicalTestFile, parseDiscoveredId } from './test-model.js';
import { hasTermwrightProvider } from './provider.js';
import { WebSocket } from 'ws';

/** Environment variable `termwright ui` sets for the reporter to find it. */
export const UI_URL_ENV = 'TERMWRIGHT_UI_URL';

/** Browser-selected files/cases, used to hide Vitest's filter-generated skips. */
export const UI_SELECTION_ENV = 'TERMWRIGHT_UI_SELECTION';

/** Where published messages go. */
export interface UiMessageSink {
  publish(message: ServerMessage): void;
}

/** What a filtered Vitest process is expected to report as real results. */
export interface UiReporterSelection {
  /** Stable discovery ids or physical files selected by the browser. */
  readonly targets?: readonly string[];
  /** Vitest's CLI name pattern, used by the initial long-lived watcher. */
  readonly testNamePattern?: string;
}

/** Options for {@link TermwrightUiReporter}. */
export interface UiReporterOptions {
  /** Server URL including its token. Default `process.env.TERMWRIGHT_UI_URL`. */
  readonly url?: string;
  /** Publish directly instead of over a socket, when the server is in-process. */
  readonly sink?: UiMessageSink;
  /**
   * Where run manifests are written, so the panel can list past runs. Default
   * `.termwright/runs` under the current working directory; `null` disables
   * history for this reporter.
   */
  readonly runsDir?: string | null;
  /**
   * Read the steps of each finished test's trace and emit them on the timeline.
   * Default true. Steps arrive when the test ends, not while it runs: Vitest
   * reports tests, and step boundaries only exist inside the worker.
   */
  readonly stepsFromTraces?: boolean;
  /** Browser targets or a watcher filter. Defaults to the worker environment. */
  readonly selection?: readonly string[] | UiReporterSelection;
}

/**
 * A test annotation, as Vitest 3.2 delivers it to `onTestCaseAnnotate`.
 *
 * This is the channel a worker has to a reporter: `@termwright/test` can
 * annotate each driver action, and the annotation arrives here while the test
 * is still running. Read structurally, like everything else in this file.
 */
interface AnnotationLike {
  readonly type?: string;
  readonly message?: string;
  readonly attachment?: { readonly body?: unknown; readonly contentType?: string };
}

/** Structural view of the Vitest 3 `TestCase` this reporter reads. */
interface TestCaseLike {
  readonly id?: string;
  readonly name?: string;
  readonly fullName?: string;
  readonly module?: { readonly moduleId?: string };
  result?: () => { state?: string; errors?: readonly { message?: string }[] } | undefined;
  diagnostic?: () => { duration?: number; retryCount?: number; flaky?: boolean } | undefined;
  meta?: () =>
    | {
        termwright?: {
          provider?: unknown;
          traces?: readonly string[];
          lostLogRecords?: number;
          attemptFailures?: readonly {
            attempt?: number;
            errors?: readonly { message?: string; stack?: string }[];
            traceRefs?: readonly string[];
          }[];
        };
      }
    | undefined;
}

/**
 * Reporter publishing a run as `§UI events`.
 */
export class TermwrightUiReporter {
  readonly #options: UiReporterOptions;
  #sink: UiMessageSink | undefined;
  #socket: SocketSink | undefined;
  #counts = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  #startedAt = 0;
  #tests: RunTest[] = [];
  #pending: Promise<void>[] = [];
  #started = new Set<string>();
  #testStartedAt = new Map<string, number>();
  #annotatedSteps = new Map<string, Set<string>>();
  readonly #selection: ResolvedSelection | null;

  constructor(options: UiReporterOptions = {}) {
    this.#options = options;
    this.#selection = resolveSelection(options.selection ?? selectionFromEnvironment());
  }

  onTestRunStart(): void {
    this.#tests = [];
    this.#pending = [];
    this.#started.clear();
    this.#testStartedAt.clear();
    this.#annotatedSteps.clear();
    this.#counts = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
    this.#startedAt = Date.now();
    this.#sink = this.#options.sink ?? this.#connect();
    this.#publish({ v: 1, type: 'run-start', mode: 'live', startedAt: this.#startedAt });
  }

  onTestCaseReady(testCase: TestCaseLike): void {
    if (!hasTermwrightProvider(testCase.meta?.())) return;
    const id = testCase.id;
    if (id === undefined) return;
    if (!this.#isSelected(testCase)) return;
    this.#started.add(id);
    const startedAt = Date.now();
    this.#testStartedAt.set(id, startedAt);
    this.#publish({
      v: 1,
      type: 'test-start',
      id,
      title: testCase.fullName ?? testCase.name ?? id,
      // Vitest always knows which module a test came from; the fallback keeps
      // the field present, which the protocol requires, rather than dropping
      // the message.
      file: canonicalTestFile(testCase.module?.moduleId ?? ''),
      startedAt,
    });
  }

  onTestCaseResult(testCase: TestCaseLike): void {
    if (!hasTermwrightProvider(testCase.meta?.())) return;
    const id = testCase.id;
    if (id === undefined) return;
    const status = toStatus(testCase.result?.()?.state);
    if (status === undefined) return;
    // Vitest reports every sibling excluded by file:line/name filtering as
    // skipped. Those are not test results. A genuinely skipped selected case
    // still matches the selection and remains visible.
    if (status === 'skipped' && !this.#isSelected(testCase)) return;
    // Vitest does not call onTestCaseReady for a declared `.skip`. Publish the
    // case metadata once here so the result reconciles with discovery rather
    // than appearing as a second, source-less row.
    if (status === 'skipped' && !this.#started.has(id)) {
      this.#started.add(id);
      this.#publish({
        v: 1,
        type: 'test-start',
        id,
        title: testCase.fullName ?? testCase.name ?? id,
        file: canonicalTestFile(testCase.module?.moduleId ?? ''),
        startedAt: Date.now(),
      });
    }
    const diagnostic = testCase.diagnostic?.();
    const flaky = diagnostic?.flaky === true || (status === 'passed' && (diagnostic?.retryCount ?? 0) > 0);
    this.#counts.total += 1;
    this.#counts[status] += 1;
    if (flaky) this.#counts.flaky += 1;
    const meta = testCase.meta?.()?.termwright;
    const trace = meta?.traces?.[0];
    // `@termwright/test` omits the count when nothing was lost, so an absent
    // field means zero here — that is the producer's documented encoding, not
    // this reporter guessing at a missing value.
    const lostLogRecords = meta?.lostLogRecords ?? 0;
    const error = status === 'failed' ? testCase.result?.()?.errors?.[0]?.message : undefined;
    const attempts = attemptsFor(testCase, status, diagnostic?.retryCount ?? 0, diagnostic?.duration);
    if (trace !== undefined && this.#options.stepsFromTraces !== false) {
      this.#pending.push(this.#publishSteps(id, trace));
    }
    this.#tests.push({
      id,
      title: testCase.fullName ?? testCase.name ?? id,
      file: canonicalTestFile(testCase.module?.moduleId ?? ''),
      status,
      durationMs: diagnostic?.duration ?? 0,
      flaky,
      lostLogRecords,
      ...(trace === undefined ? {} : { traceRef: trace }),
      ...(error === undefined ? {} : { error }),
      ...(attempts.length <= 1 ? {} : { attempts }),
    });
    this.#publish({
      v: 1,
      type: 'test-end',
      id,
      status,
      // Both required: Vitest reports a duration for every finished test, and
      // flakiness is a fact about the result, not an optional annotation.
      durationMs: diagnostic?.duration ?? 0,
      flaky,
      lostLogRecords,
      ...(trace === undefined ? {} : { traceRef: trace }),
      ...(error === undefined ? {} : { error }),
      ...(attempts.length <= 1 ? {} : {
        attempt: attempts.at(-1)?.attempt ?? 1,
        priorFailures: attempts
          .filter((attempt) => attempt.status === 'failed' && attempt.attempt < (attempts.at(-1)?.attempt ?? 1))
          .map((attempt) => ({ attempt: attempt.attempt, errors: attempt.errors })),
      }),
    });
  }

  /**
   * A `termwright:action` annotation from the test process becomes an `action`
   * message, so the command log fills in while the test runs rather than only
   * after its trace is written.
   *
   * Annotations of any other type are ignored: this reporter shares the channel
   * with whatever else the suite annotates.
   */
  onTestCaseAnnotate(testCase: TestCaseLike, annotation: AnnotationLike): void {
    if (!hasTermwrightProvider(testCase.meta?.())) return;
    const body = annotation.attachment?.body;
    const parsed = typeof body === 'string' ? safeParse(body) : body;
    if (typeof parsed !== 'object' || parsed === null) return;
    const action = parsed as Record<string, unknown>;
    if (annotation.type === 'termwright:step') {
      const title = action['title'];
      const phase = action['phase'];
      if (testCase.id === undefined || typeof title !== 'string' || (phase !== 'start' && phase !== 'end')) return;
      const status = action['status'];
      const gherkin = validGherkinAnnotation(action['gherkin']);
      if (typeof action['stepId'] === 'string') {
        const ids = this.#annotatedSteps.get(testCase.id) ?? new Set<string>();
        ids.add(action['stepId']);
        this.#annotatedSteps.set(testCase.id, ids);
      }
      this.#publish({
        v: 1,
        type: 'step',
        testId: testCase.id,
        title,
        phase,
        t: Math.max(0, Date.now() - (this.#testStartedAt.get(testCase.id) ?? Date.now())),
        ...(typeof action['stepId'] === 'string' ? { stepId: action['stepId'] } : {}),
        ...(status === 'passed' || status === 'failed' ? { status } : {}),
        ...(typeof action['error'] === 'string' ? { error: action['error'] } : {}),
        ...(gherkin === undefined ? {} : { gherkin }),
      });
      return;
    }
    if (annotation.type !== 'termwright:action') return;
    const api = action['api'];
    const t = action['t'] ?? action['timeMs'];
    if (typeof api !== 'string' || typeof t !== 'number' || !Number.isFinite(t)) return;
    const optional = (key: string): Record<string, string> =>
      typeof action[key] === 'string' ? { [key]: action[key] } : {};
    this.#publish({
      v: 1,
      type: 'action',
      kind: action['kind'] === 'assert' ? 'assert' : 'action',
      api,
      t,
      ok: action['ok'] !== false,
      ...(testCase.id === undefined ? {} : { testId: testCase.id }),
      ...optional('sessionId'),
      ...optional('selector'),
      ...optional('ref'),
      ...optional('error'),
      ...optional('stepId'),
    });
  }

  async onTestRunEnd(): Promise<void> {
    // Step reads are in flight; the timeline must have them before the run is
    // declared over, or a fast suite ends with an empty timeline.
    await Promise.all(this.#pending);
    this.#pending = [];
    const summary = { ...this.#counts, durationMs: Date.now() - this.#startedAt };
    // The toast behind `run-end` links to Runs. Make the manifest observable
    // before that event so a fast click cannot land on an empty history page.
    await this.#writeManifest(summary);
    this.#publish({ v: 1, type: 'run-end', summary });
    await this.#socket?.close();
    this.#socket = undefined;
    this.#sink = undefined;
  }

  /**
   * Records the run in the history directory.
   *
   * Failure never fails the run — results are already reported, and an
   * unwritable history directory is not a test failure — but it is said out
   * loud. A run that quietly never appears in the history is the kind of gap
   * people spend an afternoon on.
   */
  async #writeManifest(summary: UiRunSummary): Promise<void> {
    const runsDir = this.#options.runsDir;
    if (runsDir === null) return;
    try {
      // Read at write time, not at start: a run that took twenty minutes was
      // still made at the commit it started from, and reading it now is one
      // process rather than one per run start.
      const git = await readRunGit(process.cwd());
      await writeRunManifest(runsDir ?? DEFAULT_RUNS_DIR, {
        v: RUN_MANIFEST_VERSION,
        id: runId(this.#startedAt),
        startedAt: this.#startedAt,
        finishedAt: Date.now(),
        summary,
        tests: this.#tests,
        ...(git === null ? {} : { git }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`termwright: this run was not added to the history (${reason})\n`);
    }
  }

  #connect(): UiMessageSink | undefined {
    const url = this.#options.url ?? process.env[UI_URL_ENV];
    if (url === undefined || url === '') return undefined;
    this.#socket = new SocketSink(url);
    return this.#socket;
  }

  #isSelected(testCase: TestCaseLike): boolean {
    if (this.#selection === null) return true;
    const id = testCase.id;
    const title = testCase.fullName ?? testCase.name ?? id ?? '';
    const file = canonicalTestFile(testCase.module?.moduleId ?? '');
    const targetsMatch =
      this.#selection.targets === undefined ||
      this.#selection.targets.some((target) => {
        if (target === id || canonicalTestFile(target) === file) return true;
        const parsed = parseDiscoveredId(target);
        return parsed !== null && parsed.file === file && parsed.title === title;
      });
    if (!targetsMatch) return false;
    const pattern = this.#selection.testNamePattern;
    if (pattern === undefined) return true;
    // Vitest applies `-t` to suite and test names joined with spaces, while its
    // reporter exposes `fullName` with ` > ` separators. Test both forms: the
    // literal form also protects titles which contain `>` themselves.
    for (const candidate of new Set([title, title.replaceAll(' > ', ' ')])) {
      pattern.lastIndex = 0;
      if (pattern.test(candidate)) return true;
    }
    return false;
  }

  #publish(message: ServerMessage): void {
    this.#sink?.publish(message);
  }

  /**
   * Reads the steps a finished test recorded and puts them on the timeline.
   * Failures are swallowed: an unreadable archive must not fail a run whose
   * tests already passed.
   */
  async #publishSteps(testId: string, tracePath: string): Promise<void> {
    try {
      const trace = await openTrace(tracePath);
      try {
        for (const step of await trace.steps()) {
          // Worker annotations already published this exact stable lifecycle
          // live. Re-reading it from the retained trace must enrich history,
          // not append a visually identical second step.
          if (this.#annotatedSteps.get(testId)?.has(step.stepId) === true) continue;
          this.#publish({
            v: 1,
            type: 'step',
            testId,
            stepId: step.stepId,
            title: step.title,
            phase: 'start',
            t: step.castOffset,
            ...(step.gherkin === undefined ? {} : { gherkin: step.gherkin }),
          });
          if (step.castEndOffset === null) continue;
          this.#publish({
            v: 1,
            type: 'step',
            testId,
            stepId: step.stepId,
            title: step.title,
            phase: 'end',
            t: step.castEndOffset,
            status: step.status === 'failed' ? 'failed' : 'passed',
            ...(step.error === undefined ? {} : { error: step.error }),
            ...(step.gherkin === undefined ? {} : { gherkin: step.gherkin }),
          });
        }
      } finally {
        await trace.close();
      }
    } catch {
      // No timeline detail for this test; the test result itself still arrives.
    }
  }
}

function validGherkinAnnotation(value: unknown): import('./events.js').UiGherkinStep | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const sourceValue = record['source'];
  if (typeof sourceValue !== 'object' || sourceValue === null) return undefined;
  const source = sourceValue as Record<string, unknown>;
  if (
    typeof record['keyword'] !== 'string' ||
    typeof record['text'] !== 'string' ||
    typeof source['file'] !== 'string' ||
    !Number.isInteger(source['line']) ||
    !Number.isInteger(source['column']) ||
    (record['background'] !== undefined && typeof record['background'] !== 'boolean')
  ) return undefined;
  return {
    keyword: record['keyword'],
    text: record['text'],
    source: { file: canonicalTestFile(source['file']), line: source['line'] as number, column: source['column'] as number },
    ...(record['background'] === true ? { background: true } : {}),
  };
}

function attemptsFor(
  testCase: TestCaseLike,
  finalStatus: UiTestStatus,
  retryCount: number,
  durationMs: number | undefined,
): readonly RunTestAttempt[] {
  const raw = testCase.meta?.()?.termwright?.attemptFailures;
  const attempts: RunTestAttempt[] = [];
  for (const failure of raw ?? []) {
    if (!Number.isInteger(failure.attempt) || (failure.attempt ?? 0) < 1) continue;
    const errors = (failure.errors ?? [])
      .map((error) => error.message)
      .filter((message): message is string => typeof message === 'string' && message !== '');
    attempts.push({
      attempt: failure.attempt as number,
      status: 'failed',
      errors: errors.length === 0 ? ['test failed'] : errors,
      ...(failure.traceRefs === undefined ? {} : { traceRefs: failure.traceRefs }),
    });
  }
  const finalAttempt = retryCount + 1;
  const finalErrors = (testCase.result?.()?.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => typeof message === 'string' && message !== '');
  const existing = attempts.findIndex((attempt) => attempt.attempt === finalAttempt);
  const exactFinalErrors = existing === -1 ? undefined : attempts[existing]?.errors;
  const final: RunTestAttempt = {
    attempt: finalAttempt,
    status: finalStatus,
    errors: finalStatus === 'failed' ? (exactFinalErrors ?? (finalErrors.length > 0 ? finalErrors : ['test failed'])) : [],
    ...(durationMs === undefined ? {} : { durationMs }),
  };
  if (existing === -1) attempts.push(final);
  else attempts[existing] = { ...attempts[existing] as RunTestAttempt, ...final };
  return attempts.sort((left, right) => left.attempt - right.attempt);
}

export default TermwrightUiReporter;

/** Buffers until the socket opens, so nothing published early is lost. */
class SocketSink implements UiMessageSink {
  readonly #socket: WebSocket;
  readonly #settled: Promise<void>;
  #queue: string[] = [];
  #open = false;
  #failed = false;

  constructor(url: string) {
    const target = new URL(url);
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    target.pathname = '/ws';
    target.searchParams.set('role', 'producer');
    this.#socket = new WebSocket(target);
    this.#settled = new Promise<void>((done) => {
      this.#socket.on('open', () => {
        this.#open = true;
        for (const message of this.#queue) this.#socket.send(message);
        this.#queue = [];
        done();
      });
      this.#socket.on('error', () => {
        // No UI listening (or it went away mid-run) is a normal condition.
        this.#failed = true;
        this.#queue = [];
        done();
      });
    });
  }

  publish(message: ServerMessage): void {
    if (this.#failed) return;
    const encoded = encodeMessage(message);
    if (this.#open) this.#socket.send(encoded);
    else this.#queue.push(encoded);
  }

  async close(): Promise<void> {
    // Wait for the handshake first: closing a connecting socket would throw
    // away everything queued during the run.
    await this.#settled;
    if (this.#failed) return;
    await new Promise<void>((done) => {
      if (this.#socket.readyState === WebSocket.CLOSED) {
        done();
        return;
      }
      this.#socket.once('close', () => done());
      this.#socket.close();
    });
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface ResolvedSelection {
  readonly targets?: readonly string[];
  readonly testNamePattern?: RegExp;
}

function resolveSelection(
  selection: readonly string[] | UiReporterSelection | null,
): ResolvedSelection | null {
  if (selection === null) return null;
  // `Array.isArray` narrows mutable arrays only; the public legacy form is
  // readonly, so spell out the safe structural cast after the runtime check.
  const input: UiReporterSelection = Array.isArray(selection)
    ? { targets: selection as readonly string[] }
    : (selection as UiReporterSelection);
  let testNamePattern: RegExp | undefined;
  if (input.testNamePattern !== undefined && input.testNamePattern !== '') {
    try {
      testNamePattern = new RegExp(input.testNamePattern);
    } catch {
      // Vitest will reject the same invalid pattern. Do not hide evidence if a
      // different runner nevertheless reaches this reporter.
      return null;
    }
  }
  if (input.targets === undefined && testNamePattern === undefined) return null;
  return {
    ...(input.targets === undefined ? {} : { targets: input.targets }),
    ...(testNamePattern === undefined ? {} : { testNamePattern }),
  };
}

function selectionFromEnvironment(): readonly string[] | UiReporterSelection | null {
  const raw = process.env[UI_SELECTION_ENV];
  if (raw === undefined || raw === '') return null;
  const parsed = safeParse(raw);
  if (Array.isArray(parsed)) {
    return parsed.every((entry): entry is string => typeof entry === 'string') ? parsed : null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const targets = record['targets'];
  const testNamePattern = record['testNamePattern'];
  if (targets !== undefined && (!Array.isArray(targets) || !targets.every((entry) => typeof entry === 'string'))) {
    return null;
  }
  if (testNamePattern !== undefined && typeof testNamePattern !== 'string') return null;
  if (targets === undefined && testNamePattern === undefined) return null;
  return {
    ...(targets === undefined ? {} : { targets: targets as string[] }),
    ...(testNamePattern === undefined ? {} : { testNamePattern }),
  };
}

function toStatus(state: string | undefined): UiTestStatus | undefined {
  if (state === 'passed' || state === 'pass') return 'passed';
  if (state === 'failed' || state === 'fail') return 'failed';
  if (state === 'skipped' || state === 'pending' || state === 'todo' || state === 'skip') return 'skipped';
  return undefined;
}

/**
 * Direct Node integrations attach to an in-process hub with this helper.
 * Vitest workers use `@termwright/ui/live-client` instead: it transports the
 * same translation over the producer WebSocket while this reporter publishes
 * run/test lifecycle from Vitest's coordinator process.
 */
export { attachSession } from './live.js';
