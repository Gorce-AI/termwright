/**
 * The frame around every view: which project, which branch, and where you are
 * in the panel.
 *
 * Navigation moved out of the timeline pane and into a sidebar for the reason
 * every runner eventually discovers — the list of specs, the history of runs
 * and the settings are *places*, not tabs inside a pane that also shows a
 * running test. Tabs inside a pane made the panel's shape depend on what it
 * happened to be showing.
 */

import { html, type TemplateResult } from 'lit-html';
import type { ProjectInfo } from '../project.js';

/** Places the panel can be. */
export type ViewName = 'specs' | 'runner' | 'runs' | 'settings';

/** What the frame shows. */
export interface SidebarModel {
  readonly project: ProjectInfo;
  readonly view: ViewName;
  /** Whether a run is going on, so the frame can say so from any view. */
  readonly running: boolean;
  /** Present when a recording or a live session is open behind the views. */
  readonly hasRunner: boolean;
  /**
   * Whether past runs can be listed. A self-contained report holds one
   * recording, so Runs is not a place it can go — and a destination that
   * always fails is worse than one that is not offered.
   */
  readonly hasHistory: boolean;
}

export interface SidebarHandlers {
  go(view: ViewName): void;
  shortcuts(): void;
}

/** One navigation entry: glyph, label, and the place it leads to. */
interface Entry {
  readonly view: ViewName;
  readonly glyph: string;
  readonly label: string;
}

/** Every place, in the order the sidebar lists them. */
export const ENTRY_VIEWS: readonly ViewName[] = ['specs', 'runner', 'runs', 'settings'];

const ENTRIES: readonly Entry[] = [
  { view: 'specs', glyph: '◫', label: 'Specs' },
  { view: 'runner', glyph: '▶', label: 'Runner' },
  { view: 'runs', glyph: '⏱', label: 'Runs' },
  { view: 'settings', glyph: '⚙', label: 'Settings' },
];

/**
 * Renders the sidebar.
 *
 * The glyphs are decorative and hidden from the accessibility tree: the label
 * beside each one is the name of the place, and a screen reader announcing
 * "black right-pointing triangle Runner" would be reading the icon twice.
 */
export function renderSidebar(model: SidebarModel, handlers: SidebarHandlers): TemplateResult {
  const shown = new Set(visibleEntries(model));
  const entries = ENTRIES.filter((entry) => shown.has(entry.view));
  return html`
    <header class="side-head">
      <span class="project" title=${model.project.name}>${model.project.name}</span>
      ${model.project.branch === null
        ? html`<span class="branch muted" title="Not a git repository, or a detached head"
            >no branch</span
          >`
        : html`<span class="branch" title="Current git branch">
            <span aria-hidden="true">⑂</span> ${model.project.branch}
          </span>`}
    </header>

    <nav aria-label="Panel">
      <ul>
        ${entries.map((entry) => renderEntry(entry, model, handlers))}
      </ul>
    </nav>

    <footer class="side-foot">
      <button class="link" data-testid="shortcuts-open" @click=${() => handlers.shortcuts()}>
        Keyboard <kbd>?</kbd>
      </button>
      <span class="muted version" data-testid="version">termwright ${model.project.version}</span>
    </footer>
  `;
}

/**
 * The places this source can actually reach.
 *
 * Separate from the rendering so the rule is testable without a DOM, which is
 * how everything else in this package pins behaviour.
 */
export function visibleEntries(model: SidebarModel): readonly ViewName[] {
  return ENTRY_VIEWS.filter((view) => view !== 'runs' || model.hasHistory);
}

function renderEntry(entry: Entry, model: SidebarModel, handlers: SidebarHandlers): TemplateResult {
  const current = model.view === entry.view;
  // The runner is a place you can only be when there is something to run or
  // replay; offering it empty would be a dead end rather than a destination.
  const disabled = entry.view === 'runner' && !model.hasRunner;
  return html`
    <li>
      <button
        class=${`nav ${current ? 'current' : ''}`}
        data-testid=${`nav-${entry.view}`}
        aria-current=${current ? 'page' : 'false'}
        ?disabled=${disabled}
        title=${disabled ? 'Nothing is running and no recording is open' : entry.label}
        @click=${() => handlers.go(entry.view)}
      >
        <span class="glyph" aria-hidden="true">${entry.glyph}</span>
        <span class="label">${entry.label}</span>
        ${entry.view === 'runner' && model.running
          ? html`<span class="running-dot" title="A run is in progress" aria-label="running"></span>`
          : ''}
      </button>
    </li>
  `;
}

/** The bar above each view: what you are looking at, and in what. */
export function renderViewHeader(
  title: string,
  context: readonly (string | null)[],
): TemplateResult {
  const facts = context.filter((fact): fact is string => fact !== null && fact !== '');
  return html`
    <header class="view-head">
      <h1 data-testid="view-title">${title}</h1>
      <span class="spacer"></span>
      ${facts.map((fact) => html`<span class="fact muted">${fact}</span>`)}
    </header>
  `;
}
