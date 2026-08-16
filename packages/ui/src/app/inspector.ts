/**
 * The semantic inspector: the accessibility tree of the terminal, rendered as a
 * tree, with the generated selector for whatever is selected.
 *
 * Selector generation is shared with the recorder — the same `generateSelector`
 * runs here and in the server's codegen, so the selector you copy is the one a
 * generated test would contain.
 */

import { html, nothing, type TemplateResult } from 'lit-html';
import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import { generateSelector, type GeneratedSelector } from '../selector.js';
import { childrenOf, rootsOf, statesOf } from '../view-model.js';

/** What the inspector needs from the app to render. */
export interface InspectorModel {
  readonly snapshot: SemanticSnapshot | null;
  /** Nodes whose children are hidden, by id. */
  readonly collapsed: ReadonlySet<string>;
  readonly revision: number | null;
  readonly selectedId: string | null;
  readonly hoveredId: string | null;
  readonly picking: boolean;
  readonly recording: boolean;
  readonly variable: string;
  readonly status: string | null;
}

/** What the inspector can ask the app to do. */
export interface InspectorHandlers {
  select(nodeId: string | null): void;
  /** Opens or closes a node's children. */
  toggle(nodeId: string): void;
  /** Arrow-key navigation inside the tree. */
  navigate(key: 'up' | 'down' | 'left' | 'right'): void;
  /** Enter on a node: hand focus to the terminal. */
  focusTerminal(): void;
  hover(nodeId: string | null): void;
  togglePick(): void;
  copySelector(selector: GeneratedSelector): void;
  recordClick(nodeId: string): void;
  recordAssertVisible(nodeId: string): void;
  recordAssertSnapshot(): void;
  recordStep(): void;
  save(): void;
}

/** Renders the inspector pane. */
export function renderInspector(model: InspectorModel, handlers: InspectorHandlers): TemplateResult {
  const snapshot = model.snapshot;
  const selector =
    snapshot !== null && model.selectedId !== null
      ? generateSelector(snapshot, model.selectedId, { root: model.variable })
      : undefined;

  return html`
    <header class="pane-head">
      <h2>Semantic tree</h2>
      <span class="muted">${snapshot === null ? 'no tree' : `revision ${model.revision ?? '?'}`}</span>
      <button
        class=${model.picking ? 'active' : ''}
        data-testid="pick"
        title="Pick a node by pointing at the terminal"
        @click=${() => handlers.togglePick()}
      >
        ${model.picking ? 'Picking…' : 'Pick'}
      </button>
    </header>

    ${snapshot === null
      ? html`<p class="empty">
          This session publishes no semantic tree. Text and cell locators still work; roles,
          names and bounds need an adapter.
        </p>`
      : html`<div
          class="tree"
          data-testid="tree"
          role="tree"
          aria-label="Semantic tree"
          @keydown=${(event: KeyboardEvent) => onTreeKey(event, handlers)}
        >
          ${rootsOf(snapshot).map((node) =>
            renderNode(node, childrenOf(snapshot), model, handlers, 1),
          )}
        </div>`}

    <footer class="selector" data-testid="selector">
      ${selector === undefined
        ? html`<span class="muted">Select a node to generate a selector.</span>`
        : html`
            <code class=${selector.unique ? '' : 'fragile'}>${selector.expression}</code>
            <div class="actions">
              <button @click=${() => handlers.copySelector(selector)}>Copy</button>
              ${model.recording
                ? html`
                    <button @click=${() => handlers.recordClick(selector.nodeId)}>Record click</button>
                    <button @click=${() => handlers.recordAssertVisible(selector.nodeId)}>
                      Assert visible
                    </button>
                  `
                : ''}
            </div>
            ${selector.unique
              ? ''
              : html`<p class="warn">
                  Positional selector: this node has no test id, name or text to key on.
                </p>`}
          `}
      ${model.recording
        ? html`<div class="actions record">
            <button data-testid="assert-here" @click=${() => handlers.recordAssertSnapshot()}>
              Assert here
            </button>
            <button @click=${() => handlers.recordStep()}>Step…</button>
            <button @click=${() => handlers.save()}>Save test</button>
          </div>`
        : ''}
      ${model.status === null ? '' : html`<p class="status">${model.status}</p>`}
    </footer>
  `;
}

/** Arrow keys move; Enter hands focus to the terminal. */
function onTreeKey(event: KeyboardEvent, handlers: InspectorHandlers): void {
  const moves: Readonly<Record<string, 'up' | 'down' | 'left' | 'right'>> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  };
  const move = moves[event.key];
  if (move !== undefined) {
    event.preventDefault();
    event.stopPropagation();
    handlers.navigate(move);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    handlers.focusTerminal();
  }
}

function renderNode(
  node: SemanticNode,
  children: Map<string, SemanticNode[]>,
  model: InspectorModel,
  handlers: InspectorHandlers,
  level: number,
): TemplateResult {
  const states = statesOf(node);
  const kids = children.get(node.id) ?? [];
  const selected = model.selectedId === node.id;
  const collapsed = model.collapsed.has(node.id);
  const classes = ['node', selected ? 'selected' : '', model.hoveredId === node.id ? 'hovered' : '']
    .filter(Boolean)
    .join(' ');
  // The children group lives INSIDE the treeitem, as the ARIA tree pattern
  // requires: a group that is a sibling belongs to nothing.
  return html`
    <div
      class=${classes}
      role="treeitem"
      aria-level=${level}
      aria-selected=${selected ? 'true' : 'false'}
      aria-label=${nodeLabel(node, states)}
      aria-expanded=${kids.length === 0 ? nothing : collapsed ? 'false' : 'true'}
      tabindex=${selected ? 0 : -1}
      data-node-id=${node.id}
      @click=${(event: Event) => {
        event.stopPropagation();
        handlers.select(node.id);
      }}
      @mouseenter=${(event: Event) => {
        event.stopPropagation();
        handlers.hover(node.id);
      }}
      @mouseleave=${() => handlers.hover(null)}
    >
      <span class="row">
        ${kids.length === 0
          ? ''
          : html`<span
              class="twisty"
              aria-hidden="true"
              @click=${(event: Event) => {
                event.stopPropagation();
                handlers.toggle(node.id);
              }}
              >${collapsed ? '▸' : '▾'}</span
            >`}
        <span class="role">${node.role}</span>
        ${node.name === '' ? '' : html`<span class="name">"${node.name}"</span>`}
        ${node.testId === undefined ? '' : html`<span class="testid">#${node.testId}</span>`}
        ${states.length === 0 ? '' : html`<span class="states">[${states.join(' ')}]</span>`}
      </span>
      ${kids.length === 0 || collapsed
        ? ''
        : html`<div class="children" role="group">
            ${kids.map((child) => renderNode(child, children, model, handlers, level + 1))}
          </div>`}
    </div>
  `;
}

/**
 * What a screen reader announces for a tree row: the role, the name, and the
 * states — the same three things the row shows visually, in one string rather
 * than as three unlabelled spans.
 */
function nodeLabel(node: SemanticNode, states: readonly string[]): string {
  const parts: string[] = [node.role];
  if (node.name !== '') parts.push(`"${node.name}"`);
  if (states.length > 0) parts.push(states.join(' '));
  return parts.join(' ');
}
