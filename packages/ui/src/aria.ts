/**
 * The semantic tree, as accessibility.
 *
 * The protocol's roles are ARIA-aligned by design, which makes this mapping a
 * translation rather than an interpretation: a terminal `button` becomes a real
 * `<button>`, a `dialog` becomes `role="dialog"` with `aria-modal`, a `list`
 * becomes `<ul role="list">`. What a screen reader announces over the Semantic
 * view is therefore what the terminal application actually published — not a
 * description of a screenshot.
 *
 * State maps the same way, with one rule that keeps it honest: an ARIA
 * attribute is emitted **only where ARIA allows it**. `aria-selected` means
 * something on a `tab` and nothing on a `listitem`, so a selected list item
 * gets `aria-current` instead of an attribute a screen reader would ignore.
 *
 * @packageDocumentation
 */

import type { SemanticNode, SemanticRole } from '@termwright/protocol';

/** An element to render for one semantic node. */
export interface AriaElement {
  /** HTML tag to use. `div`/`span` when no native element fits. */
  readonly tag: 'button' | 'ul' | 'li' | 'table' | 'tr' | 'td' | 'h3' | 'p' | 'div' | 'span';
  /** Explicit ARIA role, omitted when the tag already implies it. */
  readonly role?: string;
  /** Attributes to set, already stringified. */
  readonly attrs: Readonly<Record<string, string>>;
  /** Accessible name, when the node has one. */
  readonly label?: string;
}

/** Roles where `aria-selected` is meaningful. */
const SELECTABLE: ReadonlySet<string> = new Set(['tab', 'row', 'treeitem', 'option', 'gridcell']);

/** Roles where `aria-checked` is meaningful. */
const CHECKABLE: ReadonlySet<string> = new Set(['checkbox', 'radio', 'menuitemcheckbox']);

/** Tag and implicit role per protocol role. */
const ELEMENTS: Readonly<Record<SemanticRole, { tag: AriaElement['tag']; role?: string }>> =
  Object.freeze({
    application: { tag: 'div', role: 'application' },
    region: { tag: 'div', role: 'region' },
    dialog: { tag: 'div', role: 'dialog' },
    alert: { tag: 'div', role: 'alert' },
    status: { tag: 'div', role: 'status' },
    list: { tag: 'ul', role: 'list' },
    listitem: { tag: 'li', role: 'listitem' },
    menu: { tag: 'div', role: 'menu' },
    menuitem: { tag: 'div', role: 'menuitem' },
    // A real <button> brings keyboard behaviour and the right role for free.
    button: { tag: 'button' },
    checkbox: { tag: 'div', role: 'checkbox' },
    radio: { tag: 'div', role: 'radio' },
    tab: { tag: 'div', role: 'tab' },
    textbox: { tag: 'div', role: 'textbox' },
    heading: { tag: 'h3' },
    text: { tag: 'span' },
    progressbar: { tag: 'div', role: 'progressbar' },
    separator: { tag: 'div', role: 'separator' },
    scrollbar: { tag: 'div', role: 'scrollbar' },
    table: { tag: 'table' },
    row: { tag: 'tr' },
    cell: { tag: 'td' },
    generic: { tag: 'div' },
  });

/**
 * Translates one semantic node into the element that represents it.
 *
 * @example
 * ```ts
 * ariaElementFor({ id: 'n1', role: 'button', name: 'Save', state: { disabled: true } });
 * // { tag: 'button', attrs: { 'aria-disabled': 'true' }, label: 'Save' }
 * ```
 */
export function ariaElementFor(node: SemanticNode): AriaElement {
  const element = ELEMENTS[node.role] ?? ELEMENTS.generic;
  const role = element.role;
  const effectiveRole = role ?? implicitRole(element.tag);
  const state = node.state ?? {};
  const attrs: Record<string, string> = {};

  if (state.disabled === true) attrs['aria-disabled'] = 'true';
  if (state.busy === true) attrs['aria-busy'] = 'true';
  if (state.hidden === true) attrs['aria-hidden'] = 'true';
  if (state.readonly === true) attrs['aria-readonly'] = 'true';
  if (state.multiline === true) attrs['aria-multiline'] = 'true';
  if (state.expanded !== undefined) attrs['aria-expanded'] = String(state.expanded);
  if (state.modal === true && effectiveRole === 'dialog') attrs['aria-modal'] = 'true';
  if (state.orientation !== undefined) attrs['aria-orientation'] = state.orientation;

  if (state.checked !== undefined && CHECKABLE.has(effectiveRole)) {
    attrs['aria-checked'] = state.checked === 'mixed' ? 'mixed' : String(state.checked);
  }
  if (state.selected !== undefined) {
    // `aria-selected` on a role that does not support it is ignored by screen
    // readers; `aria-current` is the honest fallback for "this is the one".
    if (SELECTABLE.has(effectiveRole)) attrs['aria-selected'] = String(state.selected);
    else if (state.selected) attrs['aria-current'] = 'true';
  }
  if (state.level !== undefined && effectiveRole === 'heading') {
    attrs['aria-level'] = String(state.level);
  }
  if (state.positionInSet !== undefined) attrs['aria-posinset'] = String(state.positionInSet);
  if (state.setSize !== undefined) attrs['aria-setsize'] = String(state.setSize);
  if (node.scroll?.status === 'known' && effectiveRole === 'scrollbar') {
    attrs['aria-valuemin'] = '0';
    attrs['aria-valuemax'] = String(node.scroll.value.extent);
    attrs['aria-valuenow'] = String(node.scroll.value.offset);
  }

  // A textbox's content is its value; a progressbar's is its text.
  if (node.value?.status === 'known' && node.value.sensitivity === 'public' && effectiveRole === 'progressbar') {
    const numeric = Number.parseFloat(node.value.value);
    if (Number.isFinite(numeric)) attrs['aria-valuenow'] = String(numeric);
    else attrs['aria-valuetext'] = node.value.value;
  }
  if (node.description !== undefined) attrs['aria-description'] = node.description;

  return {
    tag: element.tag,
    ...(role === undefined ? {} : { role }),
    attrs,
    ...(node.name === '' ? {} : { label: node.name }),
  };
}

/**
 * What a node's text content should be in the Semantic view.
 *
 * A name is announced through the label, so repeating it as text would make a
 * screen reader say it twice. Nodes whose meaning *is* their text — `text`,
 * `textbox` — render their value instead.
 */
export function ariaTextFor(node: SemanticNode): string {
  if (node.role === 'text') return node.value?.status === 'known' && node.value.sensitivity === 'public' ? node.value.value : node.name;
  if (node.role === 'textbox') return node.value?.status === 'known' && node.value.sensitivity === 'public' ? node.value.value : '';
  return '';
}

/** The role a tag already carries, for deciding which attributes are valid. */
function implicitRole(tag: AriaElement['tag']): string {
  switch (tag) {
    case 'button':
      return 'button';
    case 'ul':
      return 'list';
    case 'li':
      return 'listitem';
    case 'table':
      return 'table';
    case 'tr':
      return 'row';
    case 'td':
      return 'cell';
    case 'h3':
      return 'heading';
    default:
      return 'generic';
  }
}
