/**
 * Run history: the runs this project has had, newest first.
 *
 * Answering "what failed yesterday" by re-running the suite is the thing this
 * view exists to stop. Each row is a finished run — when it started, what it
 * cost, how it went — and opening one loads its tests, each of which can be
 * replayed from the archive it left behind.
 */

import { html, type TemplateResult } from 'lit-html';
import type { RunSummaryEntry, RunTest } from '../runs.js';
import type { TestRow } from '../test-model.js';
import { formatMs, statusGlyph } from '../view-model.js';
import { renderTestRow } from './test-row.js';

/** What the view needs to render. */
export interface RunHistoryModel {
  readonly runs: readonly RunSummaryEntry[];
  /** The opened run, when one is. */
  readonly openId: string | null;
  /** Tests of the opened run. */
  readonly tests: readonly RunTest[];
  /** Archive currently replayed, so the row that produced it can be marked. */
  readonly openTracePath: string | null;
  readonly loading: boolean;
}

/** What the view can ask the app to do. */
export interface RunHistoryHandlers {
  open(runId: string): void;
  /** Replay the archive a test left behind. */
  openTrace(path: string): void;
  back(): void;
}

/** Renders the run history. */
export function renderRunHistory(
  model: RunHistoryModel,
  handlers: RunHistoryHandlers,
): TemplateResult {
  if (model.openId !== null) return renderRun(model, handlers);
  if (model.runs.length === 0) {
    return html`<p class="empty">
      No runs recorded yet. Every run writes a small manifest under
      <code>.termwright/runs</code>; they show up here, and the archives their tests left behind can
      be replayed from this panel.
    </p>`;
  }
  return html`<div class="runs" data-testid="runs">
    ${model.runs.map(
      (run) => html`
        <div class=${`run ${run.summary.failed > 0 ? 'failed' : 'passed'}`} data-testid="run" @click=${() => handlers.open(run.id)}>
          <span class=${`dot ${run.summary.failed > 0 ? 'failed' : 'passed'}`} aria-hidden="true">${statusGlyph(run.summary.failed > 0 ? 'failed' : 'passed')}</span>
          <span class="when">${formatWhen(run.startedAt)}</span>
          <span class="counts">
            <span class="count passed">${run.summary.passed}</span>
            <span class="count failed">${run.summary.failed}</span>
            ${run.summary.flaky === 0 ? '' : html`<span class="count flaky">${run.summary.flaky}</span>`}
          </span>
          <span class="duration">${formatMs(run.summary.durationMs)}</span>
        </div>
      `,
    )}
  </div>`;
}

function renderRun(model: RunHistoryModel, handlers: RunHistoryHandlers): TemplateResult {
  return html`
    <div class="run-detail" data-testid="run-detail">
      <div class="run-detail-head">
        <button data-testid="runs-back" @click=${() => handlers.back()}>← Runs</button>
        <span class="muted">${model.openId}</span>
      </div>
      ${model.loading
        ? html`<p class="empty">Loading…</p>`
        : html`<div class="tests">
            ${model.tests.map((test) =>
              // The same row the live list renders: a test is one object, and
              // two renderings of it would drift within a week.
              renderTestRow(asTestRow(test), {
                selectedId: openSelection(model),
                now: Date.now(),
                testId: 'run-test',
                select: (row) => {
                  if (row.traceRef !== undefined) handlers.openTrace(row.traceRef);
                },
                trailing: (row) =>
                  row.traceRef === undefined
                    ? html`<span class="muted no-trace" title="No archive was retained for this test"
                        >no trace</span
                      >`
                    : html`<span class="replay" title="Replay this test">▶</span>`,
              }),
            )}
          </div>`}
    </div>
  `;
}

/**
 * A run's test, as the shared row sees it.
 *
 * The manifest and the live list describe the same thing in the same words, so
 * this is a rename rather than a translation — and where it is not (a finished
 * run has no `running` state), the difference is the point.
 */
export function asTestRow(test: RunTest): TestRow {
  return {
    id: test.id,
    title: test.title,
    status: test.status,
    durationMs: test.durationMs,
    flaky: test.flaky,
    ...(test.file === '' ? {} : { file: test.file }),
    ...(test.traceRef === undefined ? {} : { traceRef: test.traceRef }),
    ...(test.error === undefined ? {} : { error: test.error }),
  };
}

/** The row whose archive is being replayed, so it reads as selected. */
function openSelection(model: RunHistoryModel): string | null {
  return model.tests.find((test) => test.traceRef === model.openTracePath)?.id ?? null;
}

/** `14:32 today`, `yesterday 09:04`, `12 Aug 09:04`. */
export function formatWhen(epochMs: number, now: number = Date.now()): string {
  const date = new Date(epochMs);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((startOfDay(now) - startOfDay(epochMs)) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

function startOfDay(epochMs: number): number {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
