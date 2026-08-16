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
  /** The test these commands belong to, for the header. */
  readonly title: string | null;
  /** Its file, shown under the title the way a runner names what it is running. */
  readonly file: string | null;
  /** Counters for the run this test belongs to. */
  readonly counts: { readonly passed: number; readonly failed: number; readonly skipped: number };
  /** Steps the user folded away, by row id. */
  readonly collapsed: ReadonlySet<string>;
  /** Whether this log can be run again — false in a replay. */
  readonly canRerun: boolean;
  /** Index of the row playback is on, or -1 before the first. */
  readonly currentIndex: number;
  /** Row the user clicked, kept lit while its target is highlighted. */
  readonly selectedId: string | null;
  /** False in a live run with no actions reported yet. */
  readonly available: boolean;
  /** Length of the recording, shown as a pill. `null` in a live run. */
  readonly durationMs: number | null;
  /** The archive's event log stopped early; what is listed is partial. */
  readonly incomplete: boolean;
  /** Why it stopped. */
  readonly error?: string;
}

/** What the log can ask the app to do. */
export interface CommandLogHandlers {
  /** Move to this row: seek the replay and highlight its target. */
  select(row: CommandRow): void;
  /**
   * Pointer entered or left a row. Highlighting on hover is what makes a log
   * of API calls into a map of the screen: you find the command by pointing at
   * the thing it touched, without losing the moment you are on.
   */
  hover(row: CommandRow | null): void;
  /** Fold or unfold a step's commands. */
  toggle(rowId: string): void;
  /** Run this test again. */
  rerun(): void;
}

/** Renders the command log. */
export function renderCommandLog(
  model: CommandLogModel,
  handlers: CommandLogHandlers,
): TemplateResult {
  return html`
    <header class="log-head">
      <div class="log-title">
        <span class="name" data-testid="log-title">${model.title ?? 'Commands'}</span>
        ${model.file === null
          ? ''
          : html`<span class="muted file" title=${model.file}>${model.file}</span>`}
      </div>
      <span class="counts" data-testid="log-counts">
        <span class="count passed" title=${`${model.counts.passed} passed`}>
          <span aria-hidden="true">✓</span>${model.counts.passed}
        </span>
        <span class="count failed" title=${`${model.counts.failed} failed`}>
          <span aria-hidden="true">✕</span>${model.counts.failed}
        </span>
        <span class="count skipped" title=${`${model.counts.skipped} skipped`}>
          <span aria-hidden="true">⊘</span>${model.counts.skipped}
        </span>
      </span>
      ${model.durationMs === null ? '' : html`<span class="pill">${formatMs(model.durationMs)}</span>`}
      ${model.canRerun
        ? html`<button class="rerun-log" data-testid="rerun-test" title="Run this test again" @click=${() => handlers.rerun()}>↻</button>`
        : ''}
    </header>

    ${model.rows.length === 0
      ? html`<p class="empty">
          ${model.available
            ? 'No commands recorded for this run.'
            : 'Commands appear as the test calls the driver. A replay reads them from the archive; a live run needs the test process to report them.'}
        </p>`
      : html`<div class="commands" data-testid="commands">
          ${renderRows(model, handlers)}
        </div>`}
    ${model.incomplete
      ? html`<p class="warn" data-testid="commands-incomplete">
          This recording's event log could not be read to the end, so the list stops early.
          ${model.error ?? ''}
        </p>`
      : ''}
  `;
}

/**
 * Rows, with a step's commands folded under it.
 *
 * A step is a section: `step('log in')` around three actions reads as one
 * thing that happened, and being able to fold it is what keeps a hundred-line
 * log navigable. Folding hides the commands, never the step itself — the shape
 * of the test stays visible.
 */
function renderRows(model: CommandLogModel, handlers: CommandLogHandlers): TemplateResult[] {
  return visibleRows(model.rows, model.collapsed).map(({ row, index }) =>
    renderRow(row, index, index === model.currentIndex, model, handlers),
  );
}

/**
 * The rows a folded log shows, each with its number in the full log.
 *
 * Folding is by *depth*, not by the step's id: a row belongs to the step it is
 * nested under, and a nested step carries its own id rather than its parent's,
 * so an id comparison would fold one level and leave the deeper ones on
 * screen. The index kept here is the row's position in the whole log, so the
 * gutter keeps counting the test's commands rather than the visible ones.
 */
export function visibleRows(
  rows: readonly CommandRow[],
  collapsed: ReadonlySet<string>,
): readonly { readonly row: CommandRow; readonly index: number }[] {
  const out: { row: CommandRow; index: number }[] = [];
  let foldedAt: number | null = null;

  rows.forEach((row, index) => {
    if (foldedAt !== null) {
      if (row.depth > foldedAt) return;
      foldedAt = null;
    }
    out.push({ row, index });
    if (row.kind === 'step' && collapsed.has(row.id)) foldedAt = row.depth;
  });
  return out;
}

function renderRow(
  row: CommandRow,
  index: number,
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
      @mouseenter=${() => handlers.hover(row)}
      @mouseleave=${() => handlers.hover(null)}
    >
      ${row.kind === 'step'
        ? html`<button
            class="fold"
            data-testid="fold-step"
            title=${model.collapsed.has(row.id) ? 'Show this step’s commands' : 'Fold this step'}
            @click=${(event: Event) => {
              event.stopPropagation();
              handlers.toggle(row.id);
            }}
          >
            <span aria-hidden="true">${model.collapsed.has(row.id) ? '▸' : '▾'}</span>
          </button>`
        : html`<span class="gutter" aria-hidden="true">${String(index + 1)}</span>`}
      <span class="at">${formatMs(row.t)}</span>
      ${row.kind === 'assert' ? html`<span class="chip assert">assert</span>` : ''}
      <span class="api">${row.label}</span>
      ${row.selector === undefined
        ? ''
        : html`<span class="selector" title=${row.selector}>${row.selector}</span>`}
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
