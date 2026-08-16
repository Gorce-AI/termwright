/**
 * One test, rendered once.
 *
 * A test looks the same wherever it appears — in a live run, in a discovered
 * listing, in the tests of a past run — because it *is* the same thing: a name,
 * a status, how long it took, and a way in. Two renderings of that row would
 * drift within a week, and the panel would start telling two stories about one
 * object.
 *
 * What differs between places is what clicking does and what sits at the end of
 * the row, so those are the only two things this takes as parameters.
 */

import { html, type TemplateResult } from 'lit-html';
import type { TestRow } from '../test-model.js';
import { testDuration } from '../test-model.js';
import { formatMs, statusGlyph } from '../view-model.js';

/** A step under a focused test. */
export interface TestRowStep {
  readonly stepId: string;
  readonly title: string;
  readonly status: string;
  readonly startedAt?: number | undefined;
}

/** What the row needs, beyond the test itself. */
export interface TestRowContext {
  readonly selectedId: string | null;
  /** Current epoch milliseconds, for the elapsed time of a running test. */
  readonly now: number;
  /** Steps shown under the row while it is selected. */
  readonly steps?: readonly TestRowStep[];
  /** What clicking the row does. */
  select(test: TestRow): void;
  /** Present where a rerun makes sense; absent in a replay. */
  rerun?: (testId: string) => void;
  /** Clicking a step, when steps are shown. */
  seek?: (timeMs: number) => void;
  /** Trailing affordance, e.g. "replay" or "no trace" in the run history. */
  trailing?: (test: TestRow) => TemplateResult | '';
  /** `data-testid` of the row, so each list stays addressable in tests. */
  readonly testId?: string;
}

/** Renders one test row. */
export function renderTestRow(test: TestRow, context: TestRowContext): TemplateResult {
  const duration = testDuration(test, context.now);
  const selected = context.selectedId === test.id;
  const steps = selected ? (context.steps ?? []) : [];
  return html`
    <div class=${`test ${test.status}${selected ? ' selected' : ''}`} data-testid=${context.testId ?? 'test'}>
      <div
        class="test-head"
        title=${test.status === 'not-run' ? 'Run this test' : 'Show this test'}
        @click=${() => context.select(test)}
      >
        <span class=${`dot ${test.status}`} aria-hidden="true">${statusGlyph(test.status)}</span>
        <span class="title">${test.title}</span>
        ${test.flaky === true ? html`<span class="badge flaky">flaky</span>` : ''}
        ${test.status === 'not-run' ? html`<span class="badge not-run">not run yet</span>` : ''}
        ${duration === null
          ? ''
          : html`<span class=${`duration${test.status === 'running' ? ' running' : ''}`}
              >${formatMs(duration)}</span
            >`}
        ${context.trailing?.(test) ?? ''}
        ${context.rerun === undefined
          ? ''
          : html`<button
              class="rerun-one"
              data-testid="rerun-one"
              title=${`Run "${test.title}" again`}
              @click=${(event: Event) => {
                event.stopPropagation(); // the row click focuses; this one reruns
                context.rerun?.(test.id);
              }}
            >
              ↻
            </button>`}
      </div>
      ${test.error === undefined ? '' : html`<p class="error">${test.error}</p>`}
      ${steps.length === 0
        ? ''
        : html`<ol class="steps">
            ${steps.map(
              (step) => html`
                <li
                  class=${`step ${step.status}`}
                  @click=${() => (step.startedAt === undefined ? undefined : context.seek?.(step.startedAt))}
                >
                  <span class="title">${step.title}</span>
                  ${step.startedAt === undefined
                    ? ''
                    : html`<span class="muted">${formatMs(step.startedAt)}</span>`}
                </li>
              `,
            )}
          </ol>`}
    </div>
  `;
}
