/**
 * The test list: every test of the run, grouped by file, with its status, its
 * duration, and a button to run it again on its own.
 *
 * A running test shows the time it has been running, which is the number you
 * watch when you are waiting for a suite and wondering whether something hung.
 */

import { html, type TemplateResult } from 'lit-html';
import {
  countTests,
  filterTests,
  groupTests,
  testDuration,
  type TestRow,
} from '../test-model.js';
import { formatMs } from '../view-model.js';

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
  readonly steps: readonly { stepId: string; title: string; status: string; startedAt?: number | undefined }[];
}

/** What the list can ask the app to do. */
export interface TestListHandlers {
  select(testId: string): void;
  setQuery(query: string): void;
  rerun(testId?: string): void;
  stop(): void;
  seek(timeMs: number): void;
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
        <span class="count passed">${counts.passed}</span>
        <span class="count failed">${counts.failed}</span>
        ${counts.flaky === 0 ? '' : html`<span class="count flaky">${counts.flaky}</span>`}
        ${counts.skipped === 0 ? '' : html`<span class="count skipped">${counts.skipped}</span>`}
        ${counts.running === 0 ? '' : html`<span class="count running">${counts.running}</span>`}
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
          ${model.tests.length === 0 ? 'No tests reported yet.' : 'No test matches this filter.'}
        </p>`
      : html`<div class="tests" data-testid="tests">
          ${groupTests(matching).map(
            (group) => html`
              <section class="file-group" data-testid="file-group">
                <h3 class="file" title=${group.file ?? ''}>${group.label}</h3>
                ${group.tests.map((test) => renderTest(test, model, handlers))}
              </section>
            `,
          )}
        </div>`}
  `;
}

function renderTest(
  test: TestRow,
  model: TestListModel,
  handlers: TestListHandlers,
): TemplateResult {
  const duration = testDuration(test, model.now);
  const selected = model.selectedId === test.id;
  return html`
    <div class=${`test ${test.status}${selected ? ' selected' : ''}`} data-testid="test">
      <div class="test-head" @click=${() => handlers.select(test.id)}>
        <span class=${`dot ${test.status}`}></span>
        <span class="title">${test.title}</span>
        ${test.flaky === true ? html`<span class="badge flaky">flaky</span>` : ''}
        ${duration === null
          ? ''
          : html`<span class=${`duration${test.status === 'running' ? ' running' : ''}`}
              >${formatMs(duration)}</span
            >`}
        ${model.canRerun
          ? html`<button
              class="rerun-one"
              data-testid="rerun-one"
              title=${`Run "${test.title}" again`}
              @click=${(event: Event) => {
                event.stopPropagation(); // the row click focuses; this one reruns
                handlers.rerun(test.id);
              }}
            >
              ↻
            </button>`
          : ''}
      </div>
      ${test.error === undefined ? '' : html`<p class="error">${test.error}</p>`}
      ${selected && model.steps.length > 0
        ? html`<ol class="steps">
            ${model.steps.map(
              (step) => html`
                <li
                  class=${`step ${step.status}`}
                  @click=${() => (step.startedAt === undefined ? undefined : handlers.seek(step.startedAt))}
                >
                  <span class="title">${step.title}</span>
                  ${step.startedAt === undefined
                    ? ''
                    : html`<span class="muted">${formatMs(step.startedAt)}</span>`}
                </li>
              `,
            )}
          </ol>`
        : ''}
    </div>
  `;
}
