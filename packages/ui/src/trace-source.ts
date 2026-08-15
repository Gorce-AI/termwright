/**
 * Post-mortem mode: a `.twtrace` archive from CI, opened as a timeline you can
 * scrub.
 *
 * The timeline pane is fed the same `§UI events` a live run produces, so the
 * browser has one code path for both modes. Time travel itself is a *pull*: the
 * app asks for the state at a millisecond and gets back everything needed to
 * reconstruct that moment — the cast prefix to write into a fresh terminal, the
 * viewport after every resize up to that point, and the newest semantic tree at
 * or before it. All of it comes from `openTrace().stateAt()`; this module never
 * touches archive files directly.
 *
 * @packageDocumentation
 */

import type { SemanticSnapshot } from '@termwright/protocol';
import type { StepSummary, TraceReader } from '@termwright/trace';
import type { ServerMessage, UiTestStatus } from './events.js';
import type { UiHub } from './hub.js';

/** One scrubbable moment, as the browser receives it over HTTP. */
export interface TraceStatePayload {
  /** Requested offset, clamped to the recording. */
  readonly timeMs: number;
  /** Base64 UTF-8 of the asciicast output prefix — write it into a fresh xterm. */
  readonly castPrefixB64: string;
  readonly columns: number;
  readonly rows: number;
  readonly revision: number | null;
  readonly snapshot: SemanticSnapshot | null;
  readonly step: StepSummary | null;
}

/** Everything the app needs to draw the timeline of an opened archive. */
export interface TraceOverview {
  readonly path: string;
  readonly sessionId: string;
  readonly command: readonly string[];
  readonly columns: number;
  readonly rows: number;
  /** Milliseconds since the epoch, parsed from the archive's ISO timestamp. */
  readonly startedAt: number;
  /** Length of the recording on the cast timeline. */
  readonly durationMs: number;
  readonly semanticTree: boolean;
  readonly exit: { readonly code: number | null; readonly signal: string | null } | null;
  readonly steps: readonly StepSummary[];
  /** Cast offsets worth jumping to: step boundaries and semantic revisions. */
  readonly markers: readonly { readonly t: number; readonly label: string; readonly kind: 'step' | 'revision' }[];
}

/** Reads the archive and derives everything the UI shows about it. */
export async function readTraceOverview(reader: TraceReader): Promise<TraceOverview> {
  const steps = await reader.steps();
  const markers: { t: number; label: string; kind: 'step' | 'revision' }[] = [];
  for (const step of steps) markers.push({ t: step.castOffset, label: step.title, kind: 'step' });
  let last = 0;
  for await (const record of reader.semantics()) {
    markers.push({ t: record.castOffset, label: `revision ${record.revision}`, kind: 'revision' });
    last = Math.max(last, record.castOffset);
  }
  const meta = reader.meta;
  if (meta.durationMs === undefined) {
    for await (const event of reader.castEvents()) last = Math.max(last, event.timeMs);
  } else {
    last = Math.max(last, meta.durationMs);
  }
  markers.sort((left, right) => left.t - right.t);

  return {
    path: reader.path,
    sessionId: meta.sessionId,
    command: meta.command ?? [],
    columns: meta.columns,
    rows: meta.rows,
    startedAt: Number.isFinite(Date.parse(meta.startedAt)) ? Date.parse(meta.startedAt) : 0,
    durationMs: Math.max(last, steps.at(-1)?.castEndOffset ?? 0),
    semanticTree: meta.semanticTree,
    exit: meta.exit ?? null,
    steps,
    markers,
  };
}

/**
 * Replays the archive's structure into the hub as `§UI events`, so the timeline
 * pane renders a recorded run the same way it renders a live one.
 */
export function publishTraceTimeline(hub: UiHub, overview: TraceOverview): void {
  const testId = overview.sessionId;
  const messages: ServerMessage[] = [
    { v: 1, type: 'run-start', mode: 'post-mortem', startedAt: overview.startedAt },
    {
      v: 1,
      type: 'test-start',
      id: testId,
      title: overview.command.length > 0 ? overview.command.join(' ') : testId,
      file: overview.path,
    },
  ];
  for (const step of overview.steps) {
    messages.push({
      v: 1,
      type: 'step',
      testId,
      stepId: step.stepId,
      title: step.title,
      phase: 'start',
      t: step.castOffset,
    });
    if (step.castEndOffset !== null) {
      messages.push({
        v: 1,
        type: 'step',
        testId,
        stepId: step.stepId,
        title: step.title,
        phase: 'end',
        t: step.castEndOffset,
        ...(step.status === 'failed' ? { status: 'failed' as const } : { status: 'passed' as const }),
      });
    }
  }
  const status: UiTestStatus = overview.steps.some((step) => step.status === 'failed')
    ? 'failed'
    : overview.exit !== null && overview.exit.code !== 0
      ? 'failed'
      : 'passed';
  messages.push({ v: 1, type: 'test-end', id: testId, status, traceRef: overview.path });
  messages.push({
    v: 1,
    type: 'run-end',
    summary: {
      total: 1,
      passed: status === 'passed' ? 1 : 0,
      failed: status === 'failed' ? 1 : 0,
      skipped: 0,
      durationMs: overview.durationMs,
    },
  });
  for (const message of messages) hub.publish(message);
}

/**
 * The state at one point on the recording's timeline.
 *
 * @example
 * ```ts
 * const state = await traceStateAt(reader, 1_500);
 * terminal.write(Buffer.from(state.castPrefixB64, 'base64').toString('utf8'));
 * ```
 */
export async function traceStateAt(reader: TraceReader, timeMs: number): Promise<TraceStatePayload> {
  const state = await reader.stateAt(timeMs);
  return {
    timeMs: state.timeMs,
    castPrefixB64: Buffer.from(state.castPrefix, 'utf8').toString('base64'),
    columns: state.columns,
    rows: state.rows,
    revision: state.nearestSemanticRevision,
    snapshot: state.nearestSemantic?.snapshot ?? null,
    step: state.step,
  };
}
