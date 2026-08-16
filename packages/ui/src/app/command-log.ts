/**
 * The command log: the test's steps, actions and assertions, in order, with the
 * one that is currently playing highlighted.
 *
 * Two directions of sync. Playback moves the highlight and scrolls the list;
 * clicking a row moves playback to that moment and lights up the node the
 * action targeted. Both go through the app's `seek`, so there is one notion of
 * "where we are".
 */

import { html, type TemplateResult } from 'lit-html';
import type { CommandRow } from '../commands.js';
import { formatMs } from '../view-model.js';

/** What the log needs to render. */
export interface CommandLogModel {
  readonly rows: readonly CommandRow[];
  /** Index of the row playback is on, or -1 before the first. */
  readonly currentIndex: number;
  /** Row the user clicked, kept lit while its target is highlighted. */
  readonly selectedId: string | null;
  /** False in a live run with no actions reported yet. */
  readonly available: boolean;
  /** The archive's event log stopped early; what is listed is partial. */
  readonly incomplete: boolean;
  /** Why it stopped. */
  readonly error?: string;
}

/** What the log can ask the app to do. */
export interface CommandLogHandlers {
  /** Move to this row: seek the replay and highlight its target. */
  select(row: CommandRow): void;
}

/** Renders the command log. */
export function renderCommandLog(
  model: CommandLogModel,
  handlers: CommandLogHandlers,
): TemplateResult {
  return html`
    <header class="pane-head">
      <h2>Commands</h2>
      <span class="muted" data-testid="command-count">${model.rows.length}</span>
    </header>

    ${model.rows.length === 0
      ? html`<p class="empty">
          ${model.available
            ? 'No commands recorded for this run.'
            : 'Commands appear as the test calls the driver. A replay reads them from the archive; a live run needs the test process to report them.'}
        </p>`
      : html`<div class="commands" data-testid="commands">
          ${model.rows.map((row, index) => renderRow(row, index === model.currentIndex, model, handlers))}
        </div>`}
    ${model.incomplete
      ? html`<p class="warn" data-testid="commands-incomplete">
          This recording's event log could not be read to the end, so the list stops early.
          ${model.error ?? ''}
        </p>`
      : ''}
  `;
}

function renderRow(
  row: CommandRow,
  current: boolean,
  model: CommandLogModel,
  handlers: CommandLogHandlers,
): TemplateResult {
  const outcome = row.ok === undefined ? '' : row.ok ? ' ok' : ' failed';
  const classes = [
    'command',
    row.kind,
    outcome.trim(),
    current ? 'current' : '',
    model.selectedId === row.id ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return html`
    <div
      class=${classes}
      data-testid="command"
      data-command-id=${row.id}
      style=${`padding-left:${6 + row.depth * 12}px`}
      @click=${() => handlers.select(row)}
    >
      <span class="at">${formatMs(row.t)}</span>
      <span class="api">${row.label}</span>
      ${row.selector === undefined ? '' : html`<span class="selector">${row.selector}</span>`}
      ${row.ref === undefined ? '' : html`<span class="ref">${row.ref}</span>`}
      ${row.error === undefined
        ? ''
        : html`<details class="command-error" @click=${(event: Event) => event.stopPropagation()}>
            <summary>error</summary>
            <pre>${row.error}</pre>
          </details>`}
    </div>
  `;
}
