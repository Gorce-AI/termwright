/**
 * `@termwright/trace` — the `.twtrace` archive format: writer, reader, semantic
 * diff and the self-contained HTML failure report.
 *
 * The archive layout is normative in `/CONTRACTS.md` §Trace. Nothing outside
 * this package may read or write those files directly; `@termwright/ui` and the
 * report generator both go through {@link openTrace}.
 *
 * @example
 * ```ts
 * import { createTraceWriter, openTrace, generateHtmlReport } from '@termwright/trace';
 *
 * const writer = createTraceWriter(harness, { dir: 'out/login.twtrace' });
 * const step = writer.addStep('submit the form');
 * await harness.getByRole('button', { name: 'Submit' }).click();
 * step.end('failed', 'button stayed disabled');
 * await writer.finalize({ idleTimeLimit: 2 });
 *
 * const trace = await openTrace('out/login.twtrace');
 * const state = await trace.stateAt(1_200);
 * await trace.close();
 *
 * await generateHtmlReport({
 *   outFile: 'out/report.html',
 *   results: [{ id: 't1', title: 'login', status: 'failed', tracePath: 'out/login.twtrace' }],
 * });
 * ```
 *
 * @packageDocumentation
 */

export { TraceError } from './errors.js';

export {
  TRACE_FILES,
  TRACE_VERSION,
  type ActionEvent,
  type AssertEvent,
  type InputEvent,
  type ResizeEvent,
  type SemanticRecord,
  type StepEndEvent,
  type StepStartEvent,
  type StepStatus,
  type StepSummary,
  type TraceEvent,
  type TraceEventKind,
  type TraceExit,
  type TraceMeta,
} from './types.js';

export {
  formatCastEvent,
  formatCastHeader,
  parseCast,
  parseCastEvent,
  parseCastHeader,
  streamCastEvents,
  type CastEvent,
  type CastEventCode,
  type CastHeader,
  type CastTerm,
  type ParsedCast,
} from './cast.js';

export {
  buildCastTimeline,
  hiddenOverlap,
  CastTimeline,
  type HiddenWindow,
  type TimelineOptions,
} from './timeline.js';

export {
  createTraceWriter,
  type FinalizeOptions,
  type StepHandle,
  type TraceArchive,
  type TraceSource,
  type TraceWriter,
  type TraceWriterOptions,
} from './writer.js';

export { openTrace, type TraceReader, type TraceState } from './reader.js';

export {
  openArchive,
  packTrace,
  unpackTrace,
  type ArchiveFiles,
} from './archive.js';

export {
  describe as describeSemanticNode,
  diffSemanticSnapshots,
  type ChangedNode,
  type NodeChange,
  type NodeChangeKind,
  type SemanticDiff,
  type SemanticDiffOptions,
} from './semantic-diff.js';

export {
  changedRows,
  escapeHtml,
  renderAnsiToHtml,
  type RenderOptions,
  type RenderedRow,
  type RenderedScreen,
} from './render.js';

export {
  generateHtmlReport,
  resetPlayerAssetCache,
  type ReportOptions,
  type ReportResult,
  type ReportTestResult,
  type SemanticDiffInput,
  type VisualDiffInput,
} from './report.js';
