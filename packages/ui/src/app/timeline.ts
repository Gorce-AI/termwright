/**
 * The timeline pane: tests and their steps in live mode, a scrubber with marker
 * jumps in post-mortem mode.
 *
 * Scrubbing is a pull from the server (`/api/trace/state`), because the state at
 * a moment is derived from the archive by `openTrace().stateAt()` — the browser
 * never parses a `.twtrace` itself.
 */

import { html, type TemplateResult } from 'lit-html';
import type { UiTestStatus } from '../events.js';
import type { TraceOverview } from '../trace-source.js';
import { formatMs } from '../view-model.js';
import { renderCrashPanel } from './crash-panel.js';

/** One test on the timeline, with the steps reported for it. */
export interface TimelineTest {
  readonly id: string;
  readonly title: string;
  readonly file?: string;
  status: UiTestStatus | 'running';
  traceRef?: string;
  error?: string;
  readonly steps: TimelineStep[];
}

/** One step under a test. */
export interface TimelineStep {
  readonly stepId: string;
  readonly title: string;
  status: 'running' | 'passed' | 'failed';
  startedAt?: number | undefined;
  endedAt?: number | undefined;
}

/** What the timeline needs to render. */
export interface TimelineModel {
  readonly mode: 'live' | 'post-mortem' | 'record';
  readonly tests: readonly TimelineTest[];
  readonly trace: TraceOverview | null;
  readonly timeMs: number;
  readonly connected: boolean;
  readonly summary: string | null;
}

/** What the timeline can ask the app to do. */
export interface TimelineHandlers {
  seek(timeMs: number): void;
  jump(direction: -1 | 1): void;
  rerun(testId?: string): void;
  stop(): void;
}

/** Renders the timeline pane. */
export function renderTimeline(model: TimelineModel, handlers: TimelineHandlers): TemplateResult {
  return html`
    <header class="pane-head">
      <h2>Timeline</h2>
      <span class="muted">${model.mode}${model.connected ? '' : ' — reconnecting…'}</span>
      ${model.mode === 'live'
        ? html`
            <button data-testid="rerun" @click=${() => handlers.rerun()}>Rerun</button>
            <button @click=${() => handlers.stop()}>Stop</button>
          `
        : ''}
    </header>

    ${model.trace === null ? '' : renderScrubber(model, model.trace, handlers)}
    ${renderCrashPanel(model.trace?.crash ?? null, { seek: (timeMs) => handlers.seek(timeMs) })}

    <ol class="tests" data-testid="tests">
      ${model.tests.map(
        (test) => html`
          <li class=${`test ${test.status}`} data-testid="test">
            <div class="test-head" @click=${() => handlers.rerun(test.id)}>
              <span class=${`dot ${test.status}`}></span>
              <span class="title">${test.title}</span>
            </div>
            ${test.error === undefined ? '' : html`<p class="error">${test.error}</p>`}
            <ol class="steps">
              ${test.steps.map(
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
            </ol>
          </li>
        `,
      )}
    </ol>
    ${model.summary === null ? '' : html`<footer class="summary">${model.summary}</footer>`}
  `;
}

function renderScrubber(
  model: TimelineModel,
  trace: TraceOverview,
  handlers: TimelineHandlers,
): TemplateResult {
  return html`
    <div class="scrubber">
      <button title="Previous marker" @click=${() => handlers.jump(-1)}>◀</button>
      <input
        type="range"
        data-testid="scrub"
        min="0"
        max=${Math.max(trace.durationMs, 1)}
        .value=${String(model.timeMs)}
        @input=${(event: Event) => handlers.seek(Number((event.target as HTMLInputElement).value))}
      />
      <button title="Next marker" @click=${() => handlers.jump(1)}>▶</button>
      <span class="clock" data-testid="clock">${formatMs(model.timeMs)}</span>
    </div>
    <div class="markers">
      ${trace.markers.map(
        (marker) => html`
          <button
            class=${`marker ${marker.kind}`}
            style=${`left:${(marker.t / Math.max(trace.durationMs, 1)) * 100}%`}
            title=${`${marker.label} @ ${formatMs(marker.t)}`}
            @click=${() => handlers.seek(marker.t)}
          ></button>
        `,
      )}
    </div>
  `;
}
