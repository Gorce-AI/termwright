/**
 * Where a name comes from, and — more often — where it must not.
 *
 * The protocol's adapter conventions gate descendant-text naming to nine roles.
 * The rule exists because naming containers from their content makes
 * `getByRole('region', {name: 'Approve'})` match the dialog *containing* the
 * Approve button, so every ancestor of a label becomes a plausible match and
 * locators stop being selective. That failure is quiet: the tree looks richer,
 * and the tests get worse.
 */

import type { SemanticRole } from '@termwright/protocol';

/**
 * Roles whose accessible name comes from the text they contain.
 *
 * Normative list, from the protocol README. Anything outside it is a container
 * and keeps an empty name unless an annotation gives it one.
 */
export const NAME_FROM_CONTENT: ReadonlySet<SemanticRole> = new Set<SemanticRole>([
  'button',
  'listitem',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'cell',
  'row',
  'heading',
]);

/**
 * Whether a role takes its name from the text it contains.
 *
 * `text` is included beyond the normative list: a text node's string is its
 * *own* content — naming source 2, "the widget's own label" — rather than a
 * descendant widget's. Without it `getByText` would have nothing to match.
 */
export function namesFromContent(role: SemanticRole): boolean {
  return role === 'text' || NAME_FROM_CONTENT.has(role);
}

/** Collapse whitespace the way a terminal reader would see it. */
export function normalizeName(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}
