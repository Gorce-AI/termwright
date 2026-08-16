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
import { formatMs } from '../view-model.js';

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
          <span class=${`dot ${run.summary.failed > 0 ? 'failed' : 'passed'}`}></span>
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
            ${model.tests.map(
              (test) => html`
                <div
                  class=${`test ${test.status}${model.openTracePath === test.traceRef ? ' selected' : ''}`}
                  data-testid="run-test"
                  title=${test.traceRef === undefined
                    ? 'No archive was retained for this test'
                    : 'Replay this test'}
                  @click=${() => (test.traceRef === undefined ? undefined : handlers.openTrace(test.traceRef))}
                >
                  <div class="test-head">
                    <span class=${`dot ${test.status}`}></span>
                    <span class="title">${test.title}</span>
                    ${test.flaky ? html`<span class="badge flaky">flaky</span>` : ''}
                    <span class="duration">${formatMs(test.durationMs)}</span>
                    ${test.traceRef === undefined
                      ? html`<span class="muted no-trace">no trace</span>`
                      : html`<span class="replay">▶</span>`}
                  </div>
                  ${test.error === undefined ? '' : html`<p class="error">${test.error}</p>`}
                </div>
              `,
            )}
          </div>`}
    </div>
  `;
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
