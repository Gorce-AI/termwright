/**
 * `trace.*` — reading a recorded failure the way `terminal.*` reads a live one.
 *
 * The projections are deliberately the same: a frame prints the compact ref
 * format over reconstructed screen text, and a diff reports changed rows plus
 * changed semantic subtrees, so an agent that learned the live loop already
 * knows how to read a replay.
 *
 * Reconstruction is `@termwright/trace`'s job — `stateAt()` returns the cast
 * prefix and the nearest semantic snapshot, `renderAnsiToHtml()` replays that
 * prefix through the same headless emulator the report uses. Nothing here
 * parses asciicast or drives a terminal.
 */
import { z } from 'zod';
import { renderAnsiToHtml } from '@termwright/trace';
import type { StepSummary, TraceMeta, TraceReader } from '@termwright/trace';
import { diffRows, diffSemantic } from './diff.js';
import { McpError, usageError } from './errors.js';
import { formatCompactSnapshot, refEntries } from './format.js';
import type { SemanticSnapshot } from './model.js';
import { refEntrySchema, semanticTreeState } from './schemas.js';
import { defineTool } from './tool-kit.js';
import type { ToolDefinition } from './tool-kit.js';
import { TRACE_LIMITS } from './traces.js';
import type { OpenTrace } from './traces.js';

const traceId = z.string().min(1).describe('trace handle returned by trace.open, e.g. "tr1"');

const screenshotFlag = z
  .boolean()
  .optional()
  .describe('attach a PNG of the frame (not available yet; see the error it returns)');

/**
 * PNG rendering waits on `@termwright/screenshot`. Asking for it fails loudly
 * rather than silently returning text, so an agent is never left believing it
 * received an image.
 */
function rejectScreenshot(requested: boolean | undefined): void {
  if (requested !== true) return;
  throw new McpError(
    'unsupported-action',
    'PNG screenshots are not available yet: @termwright/screenshot has not landed',
    'omit screenshot — the frame already returns reconstructed screen text and the compact tree',
  );
}

const metaSchema = z.object({
  sessionId: z.string(),
  command: z.array(z.string()),
  columns: z.number().int(),
  rows: z.number().int(),
  startedAt: z.string(),
  platform: z.string(),
  semanticTree: z.boolean(),
  durationMs: z.number().optional(),
  truncated: z.boolean().optional(),
  exit: z.object({ code: z.number().int().nullable(), signal: z.string().nullable() }).optional(),
});

function projectMeta(meta: TraceMeta): z.output<typeof metaSchema> {
  return {
    sessionId: meta.sessionId,
    command: [...meta.command],
    columns: meta.columns,
    rows: meta.rows,
    startedAt: meta.startedAt,
    platform: meta.platform,
    semanticTree: meta.semanticTree,
    ...(meta.durationMs === undefined ? {} : { durationMs: meta.durationMs }),
    ...(meta.truncated === undefined ? {} : { truncated: meta.truncated }),
    ...(meta.exit === undefined ? {} : { exit: { code: meta.exit.code, signal: meta.exit.signal } }),
  };
}

const stepSchema = z.object({
  index: z.number().int(),
  stepId: z.string(),
  title: z.string(),
  parentStepId: z.string().optional(),
  status: z.enum(['passed', 'failed', 'skipped']).nullable(),
  error: z.string().optional(),
  castOffset: z.number(),
  castEndOffset: z.number().nullable(),
});

function projectStep(step: StepSummary, index: number): z.output<typeof stepSchema> {
  return {
    index,
    stepId: step.stepId,
    title: step.title,
    ...(step.parentStepId === undefined ? {} : { parentStepId: step.parentStepId }),
    status: step.status,
    ...(step.error === undefined ? {} : { error: step.error }),
    castOffset: step.castOffset,
    castEndOffset: step.castEndOffset,
  };
}

/** Cast markers, which the writer emits one per step. */
async function markersOf(reader: TraceReader): Promise<readonly { timeMs: number; label: string }[]> {
  const markers: { timeMs: number; label: string }[] = [];
  for await (const event of reader.castEvents()) {
    if (event.code === 'm') markers.push({ timeMs: event.timeMs, label: event.data });
  }
  return markers;
}

/** One reconstructed moment: screen text plus the semantic tree that paired with it. */
interface Frame {
  readonly timeMs: number;
  readonly columns: number;
  readonly rows: number;
  readonly lines: readonly string[];
  readonly semantic: SemanticSnapshot | null;
  readonly semanticRevision: number | null;
  readonly step: StepSummary | null;
}

async function frameAt(trace: OpenTrace, timeMs: number): Promise<Frame> {
  const state = await trace.reader.stateAt(timeMs);
  const screen = await renderAnsiToHtml(state.castPrefix, {
    columns: state.columns,
    rows: state.rows,
  });
  return {
    timeMs: state.timeMs,
    columns: state.columns,
    rows: state.rows,
    lines: screen.text.split('\n'),
    semantic: (state.nearestSemantic?.snapshot as SemanticSnapshot | undefined) ?? null,
    semanticRevision: state.nearestSemanticRevision,
    step: state.step,
  };
}

/**
 * Resolves the three ways of naming a moment. Exactly one must be given: a
 * cast-timeline offset, a step from `trace.overview`, or a marker label.
 */
async function resolveTime(
  trace: OpenTrace,
  args: { timeMs?: number | undefined; stepIndex?: number | undefined; marker?: string | undefined },
): Promise<number> {
  const given = [args.timeMs, args.stepIndex, args.marker].filter((value) => value !== undefined);
  if (given.length !== 1) {
    throw usageError(
      'give exactly one of timeMs, stepIndex or marker',
      'trace.overview lists step indexes and marker labels',
    );
  }
  if (args.timeMs !== undefined) return args.timeMs;
  if (args.stepIndex !== undefined) {
    const steps = await trace.reader.steps();
    const step = steps[args.stepIndex];
    if (step === undefined) {
      throw usageError(
        `no step ${args.stepIndex}; the trace has ${steps.length}`,
        'call trace.overview for the step list',
      );
    }
    return step.castOffset;
  }
  const label = args.marker ?? '';
  const markers = await markersOf(trace.reader);
  const marker = markers.find((candidate) => candidate.label === label);
  if (marker === undefined) {
    throw usageError(
      `no marker ${JSON.stringify(label)}`,
      markers.length === 0
        ? 'this recording has no markers; use stepIndex or timeMs'
        : `markers: ${markers.map((candidate) => JSON.stringify(candidate.label)).join(', ')}`,
    );
  }
  return marker.timeMs;
}

/** Renders a frame in the compact format the live tools use. */
function renderFrame(trace: OpenTrace, frame: Frame, maxRows: number | undefined): string {
  return formatCompactSnapshot({
    terminal: trace.id,
    columns: frame.columns,
    rows: frame.rows,
    revision: frame.semanticRevision ?? 0,
    semantic: frame.semantic,
    text: frame.lines,
    maxRows: maxRows ?? TRACE_LIMITS.maxFrameRows,
  });
}

const open = defineTool({
  name: 'trace.open',
  title: 'Open a trace archive',
  description:
    'Validates a .twtrace directory or zip and returns a handle plus its metadata: the recorded ' +
    'command, viewport, duration, exit status and whether the session published a semantic tree. ' +
    'Start every replay investigation here.',
  inputSchema: {
    path: z.string().min(1).describe('path to a .twtrace directory or zip'),
  },
  outputSchema: {
    traceId: z.string(),
    path: z.string(),
    meta: metaSchema,
    steps: z.number().int(),
    evicted: z
      .string()
      .nullable()
      .describe('handle closed to make room, if the open-trace ceiling was reached'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (context, args) => {
    const { trace, evicted } = await context.traces.open(args.path);
    const meta = trace.reader.meta;
    const steps = await trace.reader.steps();
    const exit = meta.exit;
    return {
      text: [
        `Trace ${trace.id} ${meta.command.join(' ')} ${meta.columns}x${meta.rows}`,
        `recorded: ${meta.startedAt} on ${meta.platform}`,
        `semanticTree: ${meta.semanticTree ? 'available' : 'unavailable'}`,
        `steps: ${steps.length}`,
        exit === undefined
          ? 'exit: not recorded'
          : `exit: code=${String(exit.code)} signal=${String(exit.signal)}`,
        ...(meta.truncated === true ? ['warning: recording was truncated at a size limit'] : []),
        ...(evicted === null ? [] : [`note: closed ${evicted} to stay within the open-trace ceiling`]),
      ].join('\n'),
      data: {
        traceId: trace.id,
        path: trace.path,
        meta: projectMeta(meta),
        steps: steps.length,
        evicted,
      },
    };
  },
});

const overview = defineTool({
  name: 'trace.overview',
  title: 'Summarise a trace',
  description:
    'The shape of a recording: every step with its status and timing, the cast markers, the exit ' +
    'status, and which step failed. Use it to pick the moment worth reconstructing before calling ' +
    'trace.frame_at.',
  inputSchema: { traceId },
  outputSchema: {
    traceId: z.string(),
    durationMs: z.number().nullable(),
    semanticTree: semanticTreeState,
    exit: z.object({ code: z.number().int().nullable(), signal: z.string().nullable() }).nullable(),
    truncated: z.boolean(),
    steps: z.array(stepSchema),
    failedSteps: z.array(stepSchema),
    markers: z.array(z.object({ timeMs: z.number(), label: z.string() })),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const trace = context.traces.get(args.traceId);
    const meta = trace.reader.meta;
    const steps = (await trace.reader.steps()).map(projectStep);
    const failedSteps = steps.filter((step) => step.status === 'failed');
    const markers = [...(await markersOf(trace.reader))];

    const lines = [
      `Trace ${trace.id} ${meta.command.join(' ')} ${meta.columns}x${meta.rows}`,
      `semanticTree: ${meta.semanticTree ? 'available' : 'unavailable'}`,
      `duration: ${meta.durationMs === undefined ? 'unknown' : `${meta.durationMs} ms`}`,
      `exit: ${
        meta.exit === undefined
          ? 'not recorded'
          : `code=${String(meta.exit.code)} signal=${String(meta.exit.signal)}`
      }`,
      `steps: ${steps.length}${failedSteps.length === 0 ? '' : ` (${failedSteps.length} failed)`}`,
    ];
    for (const step of steps) {
      const status = step.status ?? 'unfinished';
      const window = `${step.castOffset}..${step.castEndOffset === null ? '?' : step.castEndOffset}ms`;
      lines.push(
        `  [${step.index}] ${status} ${JSON.stringify(step.title)} ${window}` +
          (step.error === undefined ? '' : `\n      ${step.error}`),
      );
    }
    if (markers.length > 0) {
      lines.push(`markers: ${markers.map((marker) => `${marker.timeMs}ms ${marker.label}`).join(', ')}`);
    }

    return {
      text: lines.join('\n'),
      data: {
        traceId: trace.id,
        durationMs: meta.durationMs ?? null,
        semanticTree: meta.semanticTree ? ('available' as const) : ('unavailable' as const),
        exit: meta.exit === undefined ? null : { code: meta.exit.code, signal: meta.exit.signal },
        truncated: meta.truncated === true,
        steps,
        failedSteps,
        markers,
      },
    };
  },
});

const frame = defineTool({
  name: 'trace.frame_at',
  title: 'Reconstruct one moment',
  description:
    'Rebuilds the screen at a moment — named by timeMs, stepIndex or marker — by replaying the ' +
    'recording into a headless emulator, and pairs it with the semantic tree of the nearest ' +
    'revision at or before that moment. Reads exactly like a live terminal.snapshot.',
  inputSchema: {
    traceId,
    timeMs: z.number().min(0).optional().describe('cast-timeline offset in milliseconds'),
    stepIndex: z.number().int().min(0).optional().describe('step index from trace.overview'),
    marker: z.string().optional().describe('cast marker label from trace.overview'),
    maxRows: z.number().int().min(1).max(10_000).optional(),
    screenshot: screenshotFlag,
  },
  outputSchema: {
    traceId: z.string(),
    timeMs: z.number(),
    columns: z.number().int(),
    rows: z.number().int(),
    semanticRevision: z.number().int().nullable(),
    semanticTree: semanticTreeState,
    step: stepSchema.partial().nullable(),
    refs: z.array(refEntrySchema),
    compact: z.string(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    rejectScreenshot(args.screenshot);
    const trace = context.traces.get(args.traceId);
    const at = await resolveTime(trace, args);
    const reconstructed = await frameAt(trace, at);
    const compact = renderFrame(trace, reconstructed, args.maxRows);
    const step = reconstructed.step;
    return {
      text: compact,
      data: {
        traceId: trace.id,
        timeMs: reconstructed.timeMs,
        columns: reconstructed.columns,
        rows: reconstructed.rows,
        semanticRevision: reconstructed.semanticRevision,
        semanticTree: reconstructed.semantic === null ? ('unavailable' as const) : ('available' as const),
        step: step === null ? null : projectStep(step, 0),
        refs:
          reconstructed.semantic === null
            ? []
            : refEntries(reconstructed.semantic).map((entry) => ({ ...entry, flags: [...entry.flags] })),
        compact,
      },
    };
  },
});

const diff = defineTool({
  name: 'trace.diff',
  title: 'What changed between two moments',
  description:
    'Reconstructs two moments of a recording and reports what moved: changed screen rows and ' +
    'changed semantic subtrees, in the same shape as terminal.capture_since on a live session.',
  inputSchema: {
    traceId,
    fromMs: z.number().min(0),
    toMs: z.number().min(0),
    maxRows: z.number().int().min(1).max(10_000).optional(),
    maxSubtrees: z.number().int().min(1).max(1_000).optional(),
    screenshot: screenshotFlag,
  },
  outputSchema: {
    traceId: z.string(),
    fromMs: z.number(),
    toMs: z.number(),
    semanticTree: semanticTreeState,
    changedRows: z.array(z.object({ row: z.number().int(), text: z.string() })),
    changedSubtrees: z.array(
      z.object({
        change: z.enum(['added', 'removed', 'updated']),
        ref: z.string(),
        role: z.string(),
        name: z.string(),
        compact: z.string(),
      }),
    ),
    compact: z.string(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    rejectScreenshot(args.screenshot);
    if (args.toMs < args.fromMs) {
      throw usageError('toMs must not precede fromMs', 'swap the two, or read trace.overview for the timeline');
    }
    const trace = context.traces.get(args.traceId);
    const before = await frameAt(trace, args.fromMs);
    const after = await frameAt(trace, args.toMs);

    const changedRows = diffRows(before.lines, after.lines).slice(
      0,
      args.maxRows ?? TRACE_LIMITS.maxFrameRows,
    );
    const changedSubtrees = diffSemantic(before.semantic, after.semantic).slice(
      0,
      args.maxSubtrees ?? 100,
    );

    const lines = [
      `Trace ${trace.id} ${before.timeMs}ms -> ${after.timeMs}ms`,
      `semanticTree: ${after.semantic === null ? 'unavailable' : 'available'}`,
      `changed rows: ${changedRows.length}`,
      ...changedRows.map((row) => `  ${row.row}: ${row.text}`),
      `changed nodes: ${changedSubtrees.length}`,
    ];
    for (const subtree of changedSubtrees) {
      const marker = subtree.change === 'added' ? '+' : subtree.change === 'removed' ? '-' : '~';
      for (const line of subtree.compact.split('\n')) lines.push(`  ${marker} ${line}`);
    }

    return {
      text: lines.join('\n'),
      data: {
        traceId: trace.id,
        fromMs: before.timeMs,
        toMs: after.timeMs,
        semanticTree: after.semantic === null ? ('unavailable' as const) : ('available' as const),
        changedRows: changedRows.map((row) => ({ ...row })),
        changedSubtrees: changedSubtrees.map((subtree) => ({ ...subtree })),
        compact: lines.join('\n'),
      },
    };
  },
});

/** The replay tools, in the order an investigation uses them. */
export const TRACE_TOOLS: readonly ToolDefinition[] = Object.freeze([open, overview, frame, diff]);
