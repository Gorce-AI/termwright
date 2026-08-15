/**
 * Level 2 of role resolution: Ink's own accessibility vocabulary and element
 * names mapped onto the closed protocol role set.
 *
 * The mapping is deliberately conservative. Ink roles with no unambiguous
 * counterpart (`combobox`, `radiogroup`, `tablist`, `toolbar`) resolve to
 * `generic` rather than to a plausible-looking neighbour: a wrong role is worse
 * than an honest `generic`, because locators silently match the wrong node.
 * A bordered `<Box>` is likewise *not* promoted to `region` — a border is a
 * styling choice, not a semantic one.
 */

import type { SemanticAction, SemanticRole } from '@termwright/protocol';

/** The role vocabulary Ink 7 accepts in the `aria-role` prop. */
export type InkAriaRole =
  | 'button'
  | 'checkbox'
  | 'combobox'
  | 'list'
  | 'listbox'
  | 'listitem'
  | 'menu'
  | 'menuitem'
  | 'option'
  | 'progressbar'
  | 'radio'
  | 'radiogroup'
  | 'tab'
  | 'tablist'
  | 'table'
  | 'textbox'
  | 'timer'
  | 'toolbar';

const ARIA_ROLE_MAP: Readonly<Record<InkAriaRole, SemanticRole>> = Object.freeze({
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

/**
 * Map an Ink `aria-role` onto a protocol role.
 *
 * @returns the mapped role, or `undefined` when the input is absent or is not
 * a role Ink defines (JavaScript callers can pass anything).
 */
export function mapInkAriaRole(role: string | undefined): SemanticRole | undefined {
  if (role === undefined) return undefined;
  return Object.hasOwn(ARIA_ROLE_MAP, role) ? ARIA_ROLE_MAP[role as InkAriaRole] : undefined;
}

const ROLE_ACTIONS: Readonly<Partial<Record<SemanticRole, readonly SemanticAction[]>>> =
  Object.freeze({
    button: Object.freeze(['activate', 'focus'] as const),
    checkbox: Object.freeze(['toggle', 'focus'] as const),
    radio: Object.freeze(['select', 'focus'] as const),
    tab: Object.freeze(['select', 'focus'] as const),
    menuitem: Object.freeze(['activate', 'focus'] as const),
    listitem: Object.freeze(['select'] as const),
    textbox: Object.freeze(['setValue', 'focus'] as const),
  });

/**
 * Default action capabilities implied by a role, used when the author did not
 * list any explicitly.
 *
 * @returns the implied actions, or `undefined` for roles that imply none.
 */
export function defaultActionsForRole(role: SemanticRole): readonly SemanticAction[] | undefined {
  return ROLE_ACTIONS[role];
}
