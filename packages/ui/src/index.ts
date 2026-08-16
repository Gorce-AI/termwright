/**
 * `@termwright/ui` — the interactive runner: a local server, a browser app with
 * a live terminal, a semantic inspector and a time-travelling timeline, and a
 * recorder that writes tests from what you do in it.
 *
 * The server talks the `§UI events` protocol from `/CONTRACTS.md` and reads
 * `.twtrace` archives only through `@termwright/trace`. It never imports Vitest:
 * a run reaches the UI through {@link TermwrightUiReporter}, which speaks the
 * same protocol from inside the test process.
 *
 * @example
 * ```ts
 * import { startUiServer } from '@termwright/ui';
 *
 * const server = await startUiServer();          // live: watch a Vitest run
 * const viewer = await startUiServer({ trace: 'out/login.twtrace' });
 * const rec = await startUiServer({ record: { command: ['node', 'app.js'] } });
 * console.log(server.url);                        // includes the session token
 * ```
 *
 * @packageDocumentation
 */

export {
  UI_PROTOCOL_VERSION,
  UiProtocolError,
  encodeMessage,
  fromBase64,
  parseClientMessage,
  parseServerMessage,
  toBase64,
  type ClientMessage,
  type ServerMessage,
  type UiMessage,
  type UiRunSummary,
  type UiServerMode,
  type UiStepPhase,
  type UiTestStatus,
} from './events.js';

export { UiHub, type UiClient, type UiHubOptions } from './hub.js';

export { attachSession, type UiSessionSource } from './live.js';

export {
  startUiServer,
  type AttachedSession,
  type UiServer,
  type UiServerOptions,
} from './server.js';

export {
  CRASH_TAIL_WARNING,
  describeCrashCause,
  parseCrash,
  type CrashDiagnosticView,
  type CrashExitView,
  type CrashInputView,
  type CrashView,
} from './crash.js';

export {
  publishTraceTimeline,
  readTraceOverview,
  traceStateAt,
  type TraceMarker,
  type TraceOverview,
  type TraceStatePayload,
} from './trace-source.js';

export {
  generateSelector,
  quote,
  type GeneratedSelector,
  type SelectorKind,
  type SelectorOptions,
} from './selector.js';

export {
  generateTestSource,
  type CodegenOptions,
  type RecordedEvent,
} from './codegen.js';

export {
  InputDecoder,
  coalesceInput,
  decodeInput,
  type DecodedInput,
} from './input-decode.js';

export {
  startRecorder,
  type RecorderOptions,
  type RecorderSession,
} from './recorder.js';

export {
  childrenOf,
  formatMs,
  nextMarker,
  nodeAt,
  rootsOf,
  statesOf,
} from './view-model.js';

export {
  TermwrightUiReporter,
  UI_URL_ENV,
  type UiMessageSink,
  type UiReporterOptions,
} from './reporter.js';
