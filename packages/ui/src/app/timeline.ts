/**
 * The timeline pane: tests and their steps in live mode, a scrubber with marker
 * jumps in post-mortem mode.
 *
 * Scrubbing is a pull from the server (`/api/trace/state`), because the state at
 * a moment is derived from the archive by `openTrace().stateAt()` — the browser
 * never parses a `.twtrace` itself.
 */

import { html, nothing, type TemplateResult } from 'lit-html';
import type { UiTestStatus } from '../events.js';
import type { TraceOverview } from '../trace-source.js';
import { formatMs } from '../view-model.js';
import { percentFor, timeAt } from '../timeline-scale.js';
import { renderCrashPanel } from './crash-panel.js';
import type { TestListHandlers, TestListModel } from './test-list.js';
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
  /**
   * True when the recording on screen stops before the session did — cut by
   * the frame ceiling, or by a report's size budget. Said out loud, because a
   * replay that just ends looks like a program that just stopped.
   */
  readonly recordingCut: boolean;
  /** Playback state, when a recording is open. */
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
}

/** What the timeline can ask the app to do. */
export interface TimelineHandlers extends TestListHandlers, RunHistoryHandlers {
  jump(direction: -1 | 1): void;
  togglePlay(): void;
  cycleSpeed(): void;
}

/** Renders the timeline pane. */
export function renderTimeline(model: TimelineModel, handlers: TimelineHandlers): TemplateResult {
  return html`
    <header class="pane-head">
      <h2>Command timeline</h2>
      <span class="spacer"></span>
      <span class="muted">${model.mode}${model.connected ? '' : ' — reconnecting…'}</span>
    </header>

    ${model.trace === null ? '' : renderScrubber(model, model.trace, handlers)}
    ${renderCrashPanel(model.trace?.crash ?? null, { seek: (timeMs) => handlers.seek(timeMs) })}

    ${renderSteps(model.testList)}
    ${model.summary === null ? '' : html`<footer class="summary">${model.summary}</footer>`}
  `;
}

/**
 * The steps of the test in focus.
 *
 * The list of specs moved to its own view, so this pane stopped being a list
 * and became what the runner actually needs: where the focused test is, on the
 * timeline above it. Rendering the list here as well would have been two live
 * copies of one component — the thing this panel exists not to do.
 */
function renderSteps(model: TestListModel): TemplateResult {
  const test = model.tests.find((candidate) => candidate.id === model.selectedId);
  if (test === undefined) {
    return html`<p class="empty" data-testid="no-focus">
      Pick a test in Specs to see its steps here.
    </p>`;
  }
  return html`
    <div class="steps" data-testid="steps">
      <h3>${test.title}</h3>
      ${model.steps.length === 0
        ? html`<p class="empty">This test reported no steps.</p>`
        : html`<ol>
            ${model.steps.map(
              (step) => html`<li class=${`step ${step.status}`}>${step.title}</li>`,
            )}
          </ol>`}
    </div>
  `;
}

function renderScrubber(
  model: TimelineModel,
  trace: TraceOverview,
  handlers: TimelineHandlers,
): TemplateResult {
  const duration = Math.max(trace.durationMs, 1);
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
      ${renderTrack(model, trace, duration, handlers)}
      <button title="Next action (→)" @click=${() => handlers.jump(1)}>▶</button>
      <span class="clock" data-testid="clock">${formatMs(model.timeMs)}</span>
      ${model.recordingCut
        ? html`<span class="warn cut" data-testid="recording-cut" title="Playback stops early; the whole recording is in the archive."
            >recording cut</span
          >`
        : ''}
    </div>
  `;
}

/**
 * The track: fill, thumb and every marker in one element.
 *
 * They must share a box, not merely look like they do. A separate marker strip
 * beside a native range input drifts — the strip has its own margins, and the
 * native thumb travels `width − thumbWidth` while a marker at `t/duration` is
 * placed against the full width. The error is zero at the left and grows to the
 * right, which is the most convincing kind of wrong: it survives a glance at
 * the start and lies at the end.
 */
function renderTrack(
  model: TimelineModel,
  trace: TraceOverview,
  duration: number,
  handlers: TimelineHandlers,
): TemplateResult {
  const seekTo = (event: PointerEvent): void => {
    const element = event.currentTarget as HTMLElement;
    handlers.seek(timeAt(event.clientX, element.getBoundingClientRect(), duration));
  };
  const marker = (
    kind: string,
    t: number,
    title: string,
    testId: string | undefined,
  ): TemplateResult => html`
    <button
      class=${`marker ${kind}`}
      data-testid=${testId ?? nothing}
      style=${`left:${percentFor(t, duration)}`}
      title=${title}
      @click=${(event: Event) => {
        event.stopPropagation();
        handlers.seek(t);
      }}
    ></button>
  `;

  return html`
    <div
      class="track"
      data-testid="scrub"
      role="slider"
      tabindex="0"
      aria-label="Playback position"
      aria-valuemin="0"
      aria-valuemax=${duration}
      aria-valuenow=${Math.round(model.timeMs)}
      aria-valuetext=${formatMs(model.timeMs)}
      @pointerdown=${(event: PointerEvent) => {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        seekTo(event);
      }}
      @pointermove=${(event: PointerEvent) => {
        if (event.buttons !== 0) seekTo(event);
      }}
      @keydown=${(event: KeyboardEvent) => {
        const step = duration / 50;
        const delta = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : undefined;
        if (delta === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        handlers.seek(Math.min(Math.max(model.timeMs + delta, 0), duration));
      }}
    >
      <div class="track-fill" style=${`width:${percentFor(model.timeMs, duration)}`}></div>
      <div class="thumb" style=${`left:${percentFor(model.timeMs, duration)}`}></div>
      ${trace.markers.map((entry) =>
        marker(entry.kind, entry.t, `${entry.label} @ ${formatMs(entry.t)}`, undefined),
      )}
      ${model.logMarks.map((log) =>
        marker(
          `log ${log.level ?? 'line'}`,
          log.t,
          `${log.level ?? 'log'}: ${log.message} @ ${formatMs(log.t)}`,
          'log-mark',
        ),
      )}
    </div>
  `;
}

