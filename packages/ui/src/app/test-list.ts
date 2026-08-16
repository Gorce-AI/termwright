/**
 * The test list: every test of the run, grouped by file, with its status, its
 * duration, and a button to run it again on its own.
 *
 * A running test shows the time it has been running, which is the number you
 * watch when you are waiting for a suite and wondering whether something hung.
 */

import { html, type TemplateResult } from 'lit-html';
import { countTests, filterTests, groupTests, type TestRow } from '../test-model.js';
import { renderTestRow, type TestRowStep } from './test-row.js';
import { statusGlyph } from '../view-model.js';

/** What the list needs to render. */
export interface TestListModel {
  readonly tests: readonly TestRow[];
  /** Substring filter over title and file. */
  readonly query: string;
  /** The focused test, whose steps and session the rest of the UI follows. */
  readonly selectedId: string | null;
  /** Whether rerun/stop controls do anything — a replay cannot rerun. */
  readonly canRerun: boolean;
  /** Current epoch milliseconds, for the elapsed time of running tests. */
  readonly now: number;
  /** Steps of the focused test, rendered under it. */
  readonly steps: readonly TestRowStep[];
}

/** What the list can ask the app to do. */
export interface TestListHandlers {
  select(testId: string): void;
  setQuery(query: string): void;
  rerun(testId?: string): void;
  stop(): void;
  seek(timeMs: number): void;
}

/**
 * One counter.
 *
 * A zero is rendered as `--`: "nothing failed" and "zero failures" are the same
 * fact but not the same sentence, and the dash reads as nothing to look at
 * while a `0` reads as a measurement worth checking.
 */
function renderCount(kind: string, value: number, label: string): TemplateResult {
  return html`<span class=${`count ${kind}`} title=${`${value} ${label}`}>
    <span aria-hidden="true">${statusGlyph(kind)}</span>${value === 0 ? '--' : value}
  </span>`;
}

/** Renders the test list. */
export function renderTestList(model: TestListModel, handlers: TestListHandlers): TemplateResult {
  const matching = filterTests(model.tests, model.query);
  const counts = countTests(model.tests);

  return html`
    <div class="test-toolbar">
      <input
        type="search"
        class="test-search"
        data-testid="test-search"
        placeholder="Filter tests"
        aria-label="Filter tests"
        .value=${model.query}
        @input=${(event: Event) => handlers.setQuery((event.target as HTMLInputElement).value)}
      />
      <span class="counts" data-testid="test-counts">
        ${renderCount('passed', counts.passed, 'passed')}
        ${renderCount('failed', counts.failed, 'failed')}
        ${counts.flaky === 0 ? '' : renderCount('flaky', counts.flaky, 'flaky')}
        ${counts.skipped === 0 ? '' : renderCount('skipped', counts.skipped, 'skipped')}
        ${counts.running === 0 ? '' : renderCount('running', counts.running, 'running')}
        ${counts.notRun === 0 ? '' : renderCount('not-run', counts.notRun, 'discovered, not run yet')}
      </span>
      ${model.canRerun
        ? html`
            <button data-testid="rerun" title="Run every test again" @click=${() => handlers.rerun()}>
              Rerun all
            </button>
            <button data-testid="stop" @click=${() => handlers.stop()}>Stop</button>
          `
        : ''}
    </div>

    ${matching.length === 0
      ? html`<p class="empty">
          ${model.tests.length === 0
            ? 'No tests yet. They appear here as soon as the project is listed, or as a run reports them.'
            : 'No test matches this filter.'}
        </p>`
      : html`<div class="tests" data-testid="tests">
          ${groupTests(matching).map(
            (group) => html`
              <section class="file-group" data-testid="file-group">
                <h3 class="file" title=${group.file ?? ''}>${group.label}</h3>
                ${group.tests.map((test) =>
                  renderTestRow(test, {
                    selectedId: model.selectedId,
                    now: model.now,
                    steps: model.steps,
                    select: (row) => handlers.select(row.id),
                    ...(model.canRerun ? { rerun: (id: string) => handlers.rerun(id) } : {}),
                    seek: (timeMs: number) => handlers.seek(timeMs),
                  }),
                )}
              </section>
            `,
          )}
        </div>`}
  `;
}
