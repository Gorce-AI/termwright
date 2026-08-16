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
import { renderTestList, type TestListHandlers, type TestListModel } from './test-list.js';
import { renderRunHistory, type RunHistoryHandlers, type RunHistoryModel } from './run-history.js';
import type { AppLogView } from '../app-log.js';
import type { PlaybackSpeed } from '../playback.js';

/** One test on the timeline, with the steps reported for it. */
export interface TimelineTest {
  readonly id: string;
  readonly title: string;
  readonly file?: string;
  status: UiTestStatus | 'running' | 'not-run';
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
  /**
   * Warn/error log lines worth marking. Live runs have no scrubber, but they
   * do have a clock, so the strip is drawn either way — clicking a mark seeks
   * in a replay and reveals the line in the log panel in both modes.
   */
  readonly logMarks: readonly AppLogView[];
  /** The test list, which owns the tests themselves. */
  readonly testList: TestListModel;
  /** Playback state, when a recording is open. */
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
  /** Which half of the pane is showing. */
  readonly view: 'tests' | 'runs';
  readonly runHistory: RunHistoryModel;
}

/** What the timeline can ask the app to do. */
export interface TimelineHandlers extends TestListHandlers, RunHistoryHandlers {
  jump(direction: -1 | 1): void;
  togglePlay(): void;
  cycleSpeed(): void;
  setView(view: 'tests' | 'runs'): void;
}

/** Renders the timeline pane. */
export function renderTimeline(model: TimelineModel, handlers: TimelineHandlers): TemplateResult {
  return html`
    <header class="pane-head">
      <nav class="segmented" aria-label="Panel view">
        <button
          class=${model.view === 'tests' ? 'active' : ''}
          data-testid="view-tests"
          @click=${() => handlers.setView('tests')}
        >
          Tests
        </button>
        <button
          class=${model.view === 'runs' ? 'active' : ''}
          data-testid="view-runs"
          @click=${() => handlers.setView('runs')}
        >
          Runs
        </button>
      </nav>
      <span class="muted">${model.mode}${model.connected ? '' : ' — reconnecting…'}</span>
    </header>

    ${model.trace === null ? '' : renderScrubber(model, model.trace, handlers)}
    ${renderMarks(model, handlers)}
    ${renderCrashPanel(model.trace?.crash ?? null, { seek: (timeMs) => handlers.seek(timeMs) })}

    ${model.view === 'runs'
      ? renderRunHistory(model.runHistory, handlers)
      : renderTestList(model.testList, handlers)}
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
      <button
        class="play"
        data-testid="play"
        title=${model.playing ? 'Pause (space)' : 'Play (space)'}
        @click=${() => handlers.togglePlay()}
      >
        ${model.playing ? '❚❚' : '▶'}
      </button>
      <button
        class="speed"
        data-testid="speed"
        title="Playback speed"
        @click=${() => handlers.cycleSpeed()}
      >
        ${model.speed}×
      </button>
      <button title="Previous action (←)" @click=${() => handlers.jump(-1)}>◀</button>
      <input
        type="range"
        data-testid="scrub"
        min="0"
        max=${Math.max(trace.durationMs, 1)}
        .value=${String(model.timeMs)}
        @input=${(event: Event) => handlers.seek(Number((event.target as HTMLInputElement).value))}
      />
      <button title="Next action (→)" @click=${() => handlers.jump(1)}>▶</button>
      <span class="clock" data-testid="clock">${formatMs(model.timeMs)}</span>
    </div>
  `;
}

/**
 * The marker strip: step boundaries, semantic revisions, the crash, and
 * warn/error log lines, all on one axis.
 *
 * The axis spans the recording in post-mortem and "the run so far" while live,
 * which is why the span is computed rather than taken from the trace.
 */
function renderMarks(model: TimelineModel, handlers: TimelineHandlers): TemplateResult | '' {
  const markers = model.trace?.markers ?? [];
  const span = Math.max(
    model.trace?.durationMs ?? 0,
    ...model.logMarks.map((log) => log.t),
    1,
  );
  if (markers.length === 0 && model.logMarks.length === 0) return '';
  const position = (t: number): string => `left:${Math.min((t / span) * 100, 100)}%`;
  return html`
    <div class="markers" data-testid="markers">
      ${markers.map(
        (marker) => html`
          <button
            class=${`marker ${marker.kind}`}
            style=${position(marker.t)}
            title=${`${marker.label} @ ${formatMs(marker.t)}`}
            @click=${() => handlers.seek(marker.t)}
          ></button>
        `,
      )}
      ${model.logMarks.map(
        (log) => html`
          <button
            class=${`marker log ${log.level ?? 'line'}`}
            data-testid="log-mark"
            style=${position(log.t)}
            title=${`${log.level ?? 'log'}: ${log.message} @ ${formatMs(log.t)}`}
            @click=${() => handlers.seek(log.t)}
          ></button>
        `,
      )}
    </div>
  `;
}
