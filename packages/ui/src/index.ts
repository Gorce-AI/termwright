/**
 * `@termwright/ui` — the interactive runner: a local server, a browser app with
 * a live terminal, a semantic inspector and a time-travelling timeline, and a
 * recorder that writes tests from what you do in it.
 *
 * The server talks the `§UI events` protocol from `/CONTRACTS.md` and reads
 * `.twtrace` archives only through `@termwright/trace`. It never imports Vitest:
 * live runs arrive from the Termwright Native Host's structured EventJournal,
 * never from a reporter mixed into test-process stdout or a sibling engine.
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

export {
  attachSession,
  streamSession,
  type UiSessionMessageSink,
  type UiSessionSource,
  type UiSessionStreamOptions,
} from './live.js';

export {
  startUiServer,
  type AttachedSession,
  type UiServer,
  type UiServerOptions,
  type UiRunHandle,
} from './server.js';

export {
  isMarked,
  parseAppLog,
  passesLevel,
  UI_LOG_LEVELS,
  type AppLogView,
  type LogAttrs,
  type LogLevel,
} from './app-log.js';

export { readTraceLogs, type LogSourceView, type TraceLogs } from './trace-logs.js';

export {
  DEFAULT_RUNS_DIR,
  RUN_MANIFEST_VERSION,
  readRunHistory,
  readRunManifest,
  type RunDetail,
  type RunManifest,
  type RunSummary,
  type RunSummaryEntry,
  type RunTest,
} from './runs.js';

export {
  discoverTests,
  canonicalTestFile,
  type DiscoveredTest,
  type DiscoveredTestAncestor,
  type DiscoveredTestKind,
  type DiscoveredTestSource,
  type DiscoveryOptions,
} from './discovery.js';

export {
  hasTermwrightProvider,
  termwrightProvider,
  termwrightProviderDeclaration,
  TERMWRIGHT_PROVIDER_VERSION,
  type TermwrightProviderMarker,
  type TermwrightProviderDeclaration,
  type TermwrightProviderDeclaredMode,
  type TermwrightProviderTaskMeta,
} from './provider.js';

export {
  buildCommandLog,
  currentCommand,
  parseRef,
  stepCommand,
  type CommandKind,
  type CommandRow,
} from './commands.js';

export { fractionFor, percentFor, timeAt } from './timeline-scale.js';

export {
  PLAYBACK_SPEEDS,
  advance,
  framesUpTo,
  initialPlayback,
  nextSpeed,
  revisionAt,
  type PlaybackFrame,
  type PlaybackSpeed,
  type PlaybackState,
} from './playback.js';

export { readCommandLog, readFrames, type TraceFrames } from './trace-playback.js';

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
  INLINE_PAYLOAD_KEY,
  InlineDataSource,
  readInlinePayload,
  type DataSource,
  type DataSourceFeatures,
  type InlinePayload,
  type ViewerState,
} from './data-source.js';

export {
  buildInlinePayload,
  renderInlineHtml,
  writeInlineReport,
  type InlineReportCut,
  type InlineReportOptions,
  type InlineReportResult,
} from './inline-report.js';

export {
  browserCommand,
  openInBrowser,
  shouldOpenBrowser,
  type OpenDecision,
} from './open-browser.js';

export { ariaElementFor, ariaTextFor, type AriaElement } from './aria.js';

export { navigateTree, type TreeKey, type TreeNavState, type TreeRow } from './tree-nav.js';

export {
  childrenOf,
  formatMs,
  nextMarker,
  nodeAt,
  rootsOf,
  statesOf,
} from './view-model.js';
