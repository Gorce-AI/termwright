/**
 * Level 2 of role resolution: OpenTUI's widget classes mapped onto the closed
 * protocol role set.
 *
 * The mapping keys on the constructor name rather than on `instanceof`, so the
 * adapter never has to import the widget classes — which matters, because
 * importing `@opentui/core` loads its native library, and a role table has no
 * business needing one.
 *
 * As in the Ink adapter, the mapping is conservative. A widget with no
 * unambiguous protocol counterpart stays `generic`: a wrong role is worse than
 * an honest `generic`, because locators then silently match the wrong node.
 * `BoxRenderable` in particular is *not* promoted to `region` or `dialog` — a
 * box is OpenTUI's layout primitive, and a border is styling, not semantics.
 */

import { SEMANTIC_ROLES, type SemanticAction, type SemanticRole } from '@termwright/protocol';

const CLASS_ROLE_MAP: Readonly<Record<string, SemanticRole>> = Object.freeze({
  // Text-bearing.
  TextRenderable: 'text',
  TextNodeRenderable: 'text',
  RootTextNodeRenderable: 'text',
  TextBufferRenderable: 'text',
  ASCIIFontRenderable: 'text',
  MarkdownRenderable: 'text',
  CodeRenderable: 'text',
  DiffRenderable: 'text',
  // Editable.
  InputRenderable: 'textbox',
  TextareaRenderable: 'textbox',
  EditBufferRenderable: 'textbox',
  // Collections.
  SelectRenderable: 'list',
  TabSelectRenderable: 'list',
  TextTableRenderable: 'table',
  // Chrome.
  ScrollBarRenderable: 'scrollbar',
  ScrollBoxRenderable: 'region',
});

/**
 * Map an OpenTUI renderable class name onto a protocol role.
 *
 * @returns the mapped role, or `undefined` for a class with no unambiguous
 * counterpart (including every layout box).
 */
export function mapRenderableClass(className: string | undefined): SemanticRole | undefined {
  if (className === undefined) return undefined;
  return Object.hasOwn(CLASS_ROLE_MAP, className) ? CLASS_ROLE_MAP[className] : undefined;
}

/**
 * Validate a role that came from an application — the `role` convention
 * property is plain JavaScript and may hold anything.
 *
 * @returns the role when it is one the protocol defines, otherwise `undefined`.
 */
export function asSemanticRole(value: unknown): SemanticRole | undefined {
  return typeof value === 'string' && (SEMANTIC_ROLES as readonly string[]).includes(value)
    ? (value as SemanticRole)
    : undefined;
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
    list: Object.freeze(['select', 'focus'] as const),
    scrollbar: Object.freeze(['scroll'] as const),
  });

/**
 * Default action capabilities implied by a role, used when the author did not
 * list any explicitly.
 *
 * @param role - the resolved role
 * @param focusable - OpenTUI's own `focusable` flag; a focusable renderable can
 * be focused whatever its role says
 * @returns the implied actions, or `undefined` when the node implies none.
 */
export function defaultActionsFor(
  role: SemanticRole,
  focusable: boolean,
): readonly SemanticAction[] | undefined {
  const base = ROLE_ACTIONS[role];
  if (base !== undefined) return base;
  return focusable ? Object.freeze(['focus' as const]) : undefined;
}
