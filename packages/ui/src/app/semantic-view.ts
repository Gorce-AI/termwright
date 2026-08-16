/**
 * The Semantic view: the terminal application rendered as accessible HTML.
 *
 * The inspector next door is a *developer* view — a tree of roles and states to
 * read and click. This is the other thing the semantic tree makes possible: the
 * application's own interface, expressed as elements a screen reader can walk.
 * A terminal cannot be read by VoiceOver or NVDA; this can, and it says what
 * the application published rather than what its glyphs look like.
 *
 * Nothing here acts on the application's behalf — pressing a button in this
 * view does not press it in the terminal (that is the recorder's job, and doing
 * it invisibly from an assistive-technology view would be a trap). Activating
 * an element selects its node, exactly like clicking it in the tree.
 *
 * Tags come from the mapping; **every ARIA attribute is applied after render**
 * by {@link applyAriaAttributes}, because lit-html cannot bind a variable set of
 * attribute names and a template per combination would be unreadable.
 */

import { html, type TemplateResult } from 'lit-html';
import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import { ariaElementFor, ariaTextFor } from '../aria.js';
import { childrenOf, rootsOf } from '../view-model.js';

/** What the view needs to render. */
export interface SemanticViewModel {
  readonly snapshot: SemanticSnapshot | null;
  readonly selectedId: string | null;
}

/** What the view can ask the app to do. */
export interface SemanticViewHandlers {
  select(nodeId: string): void;
  hover(nodeId: string | null): void;
}

/** Renders the application's tree as accessible elements. */
export function renderSemanticView(
  model: SemanticViewModel,
  handlers: SemanticViewHandlers,
): TemplateResult {
  const snapshot = model.snapshot;
  return html`
    <header class="pane-head">
      <h2>Semantic view</h2>
      <span class="muted">what a screen reader sees</span>
    </header>
    ${snapshot === null
      ? html`<p class="empty">
          This session publishes no semantic tree, so there is nothing to render accessibly. Roles
          and names need an adapter.
        </p>`
      : html`<div class="semantic-view" data-testid="semantic-view">
          ${rootsOf(snapshot).map((root) => renderNode(root, childrenOf(snapshot), model, handlers))}
        </div>`}
  `;
}

function renderNode(
  node: SemanticNode,
  children: Map<string, SemanticNode[]>,
  model: SemanticViewModel,
  handlers: SemanticViewHandlers,
): TemplateResult {
  const { tag } = ariaElementFor(node);
  const classes = `sv ${node.role}${model.selectedId === node.id ? ' selected' : ''}`;
  const id = node.id;
  const select = (event: Event): void => {
    event.stopPropagation();
    handlers.select(id);
  };
  const enter = (event: Event): void => {
    event.stopPropagation();
    handlers.hover(id);
  };
  const leave = (): void => handlers.hover(null);
  // The visible caption is decorative: `aria-label` already names the element,
  // so repeating role and name in the accessibility tree would have a screen
  // reader say everything twice. Generated CSS content would be announced too,
  // which is why the caption is a real span that can be hidden.
  const caption = html`<span class="sv-caption" aria-hidden="true"
    >${node.role}${node.name === '' ? '' : ` ${node.name}`}</span
  >`;
  const inner = html`${caption}${ariaTextFor(node)}${(children.get(node.id) ?? []).map((child) =>
    renderNode(child, children, model, handlers),
  )}`;

  // The tag set is closed, so each case is spelled out: reading this tells you
  // exactly what DOM the mapping produces.
  switch (tag) {
    case 'button':
      return html`<button class=${classes} data-node-id=${id} @click=${select} @mouseenter=${enter} @mouseleave=${leave}>
        ${inner}
      </button>`;
    case 'ul':
      return html`<ul class=${classes} data-node-id=${id} @mouseenter=${enter} @mouseleave=${leave}>
        ${inner}
      </ul>`;
    case 'li':
      return html`<li class=${classes} data-node-id=${id} @click=${select} @mouseenter=${enter}>${inner}</li>`;
    case 'table':
      return html`<table class=${classes} data-node-id=${id}>
        <tbody>
          ${inner}
        </tbody>
      </table>`;
    case 'tr':
      return html`<tr class=${classes} data-node-id=${id} @click=${select}>
        ${inner}
      </tr>`;
    case 'td':
      return html`<td class=${classes} data-node-id=${id}>${inner}</td>`;
    case 'h3':
      return html`<h3 class=${classes} data-node-id=${id} @click=${select}>${inner}</h3>`;
    case 'span':
      return html`<span class=${classes} data-node-id=${id} @click=${select}>${inner}</span>`;
    default:
      return html`<div class=${classes} data-node-id=${id} @click=${select} @mouseenter=${enter} @mouseleave=${leave}>
        ${inner}
      </div>`;
  }
}

/**
 * Applies each node's role, name and ARIA state onto the rendered DOM.
 *
 * Call after every render of the view. Attributes that no longer apply are
 * removed rather than left behind: a stale `aria-disabled` on a button the
 * application has since enabled is a lie told to a screen reader, and those are
 * the expensive kind.
 */
export function applyAriaAttributes(host: ParentNode, snapshot: SemanticSnapshot | null): void {
  if (snapshot === null) return;
  for (const node of snapshot.nodes) {
    const element = host.querySelector<HTMLElement>(`[data-node-id="${cssEscape(node.id)}"]`);
    if (element === null) continue;
    const { role, attrs, label } = ariaElementFor(node);

    for (const name of [...element.getAttributeNames()]) {
      if (name === 'aria-label') {
        if (label === undefined) element.removeAttribute(name);
        continue;
      }
      if (name.startsWith('aria-') && attrs[name] === undefined) element.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);

    if (label === undefined) element.removeAttribute('aria-label');
    else element.setAttribute('aria-label', label);

    if (role === undefined) element.removeAttribute('role');
    else element.setAttribute('role', role);
  }
}

/** Minimal escaping for the attribute selector built from a node id. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
