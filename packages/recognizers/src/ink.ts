/** Conservative role map for the only host kinds Ink retains after reconcile. */

import type { SemanticRole } from '@termwright/protocol';

const HOST_ROLES: Readonly<Record<string, SemanticRole>> = Object.freeze({
  'ink-root': 'application',
  'ink-text': 'text',
  'ink-virtual-text': 'text',
  'ink-box': 'generic',
});

/**
 * Resolve only facts the host kind itself proves.
 *
 * Ink discards source component names before host creation, so a plain box is
 * never promoted to `button` from its children or styling. A retained
 * `aria-role` travels separately as framework-native accessibility metadata.
 */
export function roleForInkHost(host: string): SemanticRole | undefined {
  return HOST_ROLES[host];
}

const ARIA_ROLES: Readonly<Record<string, SemanticRole>> = Object.freeze({
  button: 'button',
  checkbox: 'checkbox',
  combobox: 'generic',
  list: 'list',
  listbox: 'list',
  listitem: 'listitem',
  menu: 'menu',
  menuitem: 'menuitem',
  option: 'listitem',
  progressbar: 'progressbar',
  radio: 'radio',
  radiogroup: 'generic',
  tab: 'tab',
  tablist: 'generic',
  table: 'table',
  textbox: 'textbox',
  timer: 'status',
  toolbar: 'generic',
});

/** Map Ink's retained aria vocabulary without guessing ambiguous containers. */
export function roleForInkAria(role: string): SemanticRole | undefined {
  return ARIA_ROLES[role];
}
