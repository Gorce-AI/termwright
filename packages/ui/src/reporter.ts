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
import { encodeMessage, type ServerMessage, type UiTestStatus } from './events.js';
import type { UiHub } from './hub.js';
import { WebSocket } from 'ws';

/** Environment variable `termwright ui` sets for the reporter to find it. */
export const UI_URL_ENV = 'TERMWRIGHT_UI_URL';

/** Where published messages go. */
export interface UiMessageSink {
  publish(message: ServerMessage): void;
}

/** Options for {@link TermwrightUiReporter}. */
export interface UiReporterOptions {
  /** Server URL including its token. Default `process.env.TERMWRIGHT_UI_URL`. */
  readonly url?: string;
  /** Publish directly instead of over a socket, when the server is in-process. */
  readonly sink?: UiMessageSink;
  /**
   * Read the steps of each finished test's trace and emit them on the timeline.
   * Default true. Steps arrive when the test ends, not while it runs: Vitest
   * reports tests, and step boundaries only exist inside the worker.
   */
  readonly stepsFromTraces?: boolean;
}

/** Structural view of the Vitest 3 `TestCase` this reporter reads. */
interface TestCaseLike {
  readonly id?: string;
  readonly name?: string;
  readonly fullName?: string;
  readonly module?: { readonly moduleId?: string };
  result?: () => { state?: string; errors?: readonly { message?: string }[] } | undefined;
  diagnostic?: () => { duration?: number } | undefined;
  meta?: () => { termwright?: { traces?: readonly string[] } } | undefined;
}

/**
 * Reporter publishing a run as `§UI events`.
 */
export class TermwrightUiReporter {
  readonly #options: UiReporterOptions;
  #sink: UiMessageSink | undefined;
  #socket: SocketSink | undefined;
  #counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  #startedAt = 0;
  #pending: Promise<void>[] = [];

  constructor(options: UiReporterOptions = {}) {
    this.#options = options;
  }

  onTestRunStart(): void {
    this.#pending = [];
    this.#counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
    this.#startedAt = Date.now();
    this.#sink = this.#options.sink ?? this.#connect();
    this.#publish({ v: 1, type: 'run-start', mode: 'live', startedAt: this.#startedAt });
  }

  onTestCaseReady(testCase: TestCaseLike): void {
    const id = testCase.id;
    if (id === undefined) return;
    const file = testCase.module?.moduleId;
    this.#publish({
      v: 1,
      type: 'test-start',
      id,
      title: testCase.fullName ?? testCase.name ?? id,
      ...(file === undefined ? {} : { file }),
    });
  }

  onTestCaseResult(testCase: TestCaseLike): void {
    const id = testCase.id;
    if (id === undefined) return;
    const status = toStatus(testCase.result?.()?.state);
    if (status === undefined) return;
    this.#counts.total += 1;
    this.#counts[status] += 1;
    const trace = testCase.meta?.()?.termwright?.traces?.[0];
    const error = testCase.result?.()?.errors?.[0]?.message;
    if (trace !== undefined && this.#options.stepsFromTraces !== false) {
      this.#pending.push(this.#publishSteps(id, trace));
    }
    this.#publish({
      v: 1,
      type: 'test-end',
      id,
      status,
      ...(trace === undefined ? {} : { traceRef: trace }),
      ...(error === undefined ? {} : { error }),
    });
  }

  async onTestRunEnd(): Promise<void> {
    // Step reads are in flight; the timeline must have them before the run is
    // declared over, or a fast suite ends with an empty timeline.
    await Promise.all(this.#pending);
    this.#pending = [];
    this.#publish({
      v: 1,
      type: 'run-end',
      summary: { ...this.#counts, durationMs: Date.now() - this.#startedAt },
    });
    await this.#socket?.close();
    this.#socket = undefined;
    this.#sink = undefined;
  }

  #connect(): UiMessageSink | undefined {
    const url = this.#options.url ?? process.env[UI_URL_ENV];
    if (url === undefined || url === '') return undefined;
    this.#socket = new SocketSink(url);
    return this.#socket;
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
          this.#publish({
            v: 1,
            type: 'step',
            testId,
            stepId: step.stepId,
            title: step.title,
            phase: 'start',
            t: step.castOffset,
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

function toStatus(state: string | undefined): UiTestStatus | undefined {
  if (state === 'passed' || state === 'pass') return 'passed';
  if (state === 'failed' || state === 'fail') return 'failed';
  if (state === 'skipped' || state === 'pending' || state === 'todo' || state === 'skip') return 'skipped';
  return undefined;
}

/**
 * Live sessions are attached to the hub, not to the reporter: a Vitest worker
 * runs in its own process and cannot reach the server's hub, and shipping every
 * PTY byte through the reporter's IPC channel would slow down the run it is
 * supposed to observe. In-process runs (`termwright ui` driving Vitest through
 * its Node API) attach with `attachSession` from the package root; out-of-process
 * runs get their output and semantics from the trace, on the timeline.
 */
export { attachSession } from './live.js';
