/**
 * The log panel: what the program said where the screen could not show it.
 *
 * Two controls, both of which exist because a log pane that scrolls away from
 * what you are reading is useless: a level threshold, and an autoscroll toggle
 * that the app turns off for you the moment you scroll up.
 */

import { html, type TemplateResult } from 'lit-html';
import {
  isMarked,
  passesLevel,
  UI_LOG_LEVELS,
  type AppLogView,
  type LogLevel,
} from '../app-log.js';
import { formatMs } from '../view-model.js';

/** Threshold of the level filter. */
export type LevelFilter = LogLevel | 'all';

/** What the panel needs to render. */
export interface LogPanelModel {
  readonly logs: readonly AppLogView[];
  readonly filter: LevelFilter;
  readonly autoscroll: boolean;
  /**
   * False when nothing recorded logs at all — an archive from before logs
   * existed, or a session that followed no file and had no instrumented
   * adapter. Distinguishes "nothing was recorded" from "nothing matched".
   */
  readonly available: boolean;
  /** True when records were dropped to stay within the display bound. */
  readonly truncated: boolean;
  /**
   * Whole-recording counts per level, when the source knows them. Shown in the
   * header, so "2 errors" stays true even while the list is filtered or clipped
   * to the scrub position.
   */
  readonly levels: Readonly<Partial<Record<LogLevel, number>>>;
  /**
   * In post-mortem, the scrub position: rows after it are not shown, because
   * they had not happened yet at the moment the terminal is showing.
   */
  readonly upToMs: number | null;
}

/** What the panel can ask the app to do. */
export interface LogPanelHandlers {
  setFilter(filter: LevelFilter): void;
  toggleAutoscroll(): void;
  /** A row was clicked: move the replay to that moment, when there is one. */
  seek(timeMs: number): void;
}

/** Rows the panel would show for a model — the filter, in one place. */
export function visibleLogs(model: LogPanelModel): readonly AppLogView[] {
  const upTo = model.upToMs;
  return model.logs.filter(
    (log) => (upTo === null || log.t <= upTo) && passesLevel(log, model.filter),
  );
}

/** Renders the log pane. */
export function renderLogPanel(model: LogPanelModel, handlers: LogPanelHandlers): TemplateResult {
  const rows = visibleLogs(model);
  return html`
    <header class="pane-head">
      <h2>Logs</h2>
      <span class="muted" data-testid="log-count">${rows.length}${model.truncated ? '+' : ''}</span>
      ${summarise(model.levels) === '' ? '' : html`<span class="severities" data-testid="log-severities">${summarise(model.levels)}</span>`}
      <select
        data-testid="log-filter"
        aria-label="Minimum level"
        @change=${(event: Event) =>
          handlers.setFilter((event.target as HTMLSelectElement).value as LevelFilter)}
      >
        ${(['all', ...UI_LOG_LEVELS] as LevelFilter[]).map(
          (level) =>
            html`<option value=${level} ?selected=${level === model.filter}>${level}</option>`,
        )}
      </select>
      <button
        class=${model.autoscroll ? 'active' : ''}
        data-testid="log-autoscroll"
        title="Follow new lines as they arrive"
        @click=${() => handlers.toggleAutoscroll()}
      >
        Follow
      </button>
    </header>

    ${!model.available
      ? html`<p class="empty">
          Nothing recorded logs here. A session follows log files given to
          <code>launch({ logs: [...] })</code>, and an instrumented adapter can forward structured
          records over the semantic channel.
        </p>`
      : rows.length === 0
        ? html`<p class="empty">No lines at this level${model.upToMs === null ? '' : ' yet'}.</p>`
        : html`<div class="logs" data-testid="logs">
            ${rows.map((log) => renderRow(log, handlers))}
          </div>`}
    ${model.truncated
      ? html`<p class="muted trunc">Older lines omitted; the full log is in the archive.</p>`
      : ''}
  `;
}

/** Level names as they read in a sentence. */
const LEVEL_NOUNS: Readonly<Record<LogLevel, string>> = Object.freeze({
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
  fatal: 'fatal',
});

/** `2 errors, 1 warning` — only the levels that occurred, worst first. */
export function summarise(levels: Readonly<Partial<Record<LogLevel, number>>>): string {
  const parts: string[] = [];
  for (const level of [...UI_LOG_LEVELS].reverse()) {
    const count = levels[level] ?? 0;
    if (count > 0) parts.push(`${count} ${LEVEL_NOUNS[level]}${count === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

function renderRow(log: AppLogView, handlers: LogPanelHandlers): TemplateResult {
  const level = log.level ?? 'line';
  return html`
    <div
      class=${`log ${level}${isMarked(log) ? ' marked' : ''}`}
      data-testid="log"
      @click=${() => handlers.seek(log.t)}
    >
      <span class="at">${formatMs(log.t)}</span>
      <span class=${`level ${level}`}>${level}</span>
      ${log.label === undefined && log.logger === undefined
        ? ''
        : html`<span class="from">${log.logger ?? log.label}</span>`}
      <span class="message">${log.message}</span>
      ${log.attrs === undefined
        ? ''
        : html`<span class="attrs"
            >${Object.entries(log.attrs)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(' ')}</span
          >`}
    </div>
  `;
}
