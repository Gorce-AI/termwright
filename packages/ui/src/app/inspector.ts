/**
 * The semantic inspector: the accessibility tree of the terminal, rendered as a
 * tree, with the generated selector for whatever is selected.
 *
 * Selector generation is shared with the recorder — the same `generateSelector`
 * runs here and in the server's codegen, so the selector you copy is the one a
 * generated test would contain.
 */

import { html, type TemplateResult } from 'lit-html';
import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import { generateSelector, type GeneratedSelector } from '../selector.js';
import { childrenOf, rootsOf, statesOf } from '../view-model.js';

/** What the inspector needs from the app to render. */
export interface InspectorModel {
  readonly snapshot: SemanticSnapshot | null;
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
      : html`<div class="tree" data-testid="tree">
          ${rootsOf(snapshot).map((node) => renderNode(node, childrenOf(snapshot), model, handlers))}
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

function renderNode(
  node: SemanticNode,
  children: Map<string, SemanticNode[]>,
  model: InspectorModel,
  handlers: InspectorHandlers,
): TemplateResult {
  const states = statesOf(node);
  const classes = [
    'node',
    model.selectedId === node.id ? 'selected' : '',
    model.hoveredId === node.id ? 'hovered' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return html`
    <div class="subtree">
      <div
        class=${classes}
        data-node-id=${node.id}
        @click=${(event: Event) => {
          event.stopPropagation();
          handlers.select(node.id);
        }}
        @mouseenter=${() => handlers.hover(node.id)}
        @mouseleave=${() => handlers.hover(null)}
      >
        <span class="role">${node.role}</span>
        ${node.name === '' ? '' : html`<span class="name">"${node.name}"</span>`}
        ${node.testId === undefined ? '' : html`<span class="testid">#${node.testId}</span>`}
        ${states.length === 0 ? '' : html`<span class="states">[${states.join(' ')}]</span>`}
      </div>
      <div class="children">
        ${(children.get(node.id) ?? []).map((child) => renderNode(child, children, model, handlers))}
      </div>
    </div>
  `;
}
