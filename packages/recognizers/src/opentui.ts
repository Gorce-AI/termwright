/**
 * OpenTUI's widget vocabulary, mapped onto the protocol's closed role set.
 *
 * OpenTUI has **no accessibility layer at all** — the Phase 0 audit found no
 * `role`, no `aria`, no `checked` anywhere in its types — so the class name is
 * the only signal there is. That makes this map level 2 of role resolution: it
 * runs after an author annotation and before `generic`.
 *
 * The map is deliberately short. A widget with no unambiguous counterpart stays
 * `generic` and keeps its `frameworkType`, which is what the protocol's D1
 * decision exists for: an unrecognised widget survives with its bounds, text
 * and children instead of being dropped, and a test can still find it by what
 * the framework called it. Inventing `tab` for `TabSelectRenderable` would be
 * the opposite trade — a role that reads right and makes locators match the
 * wrong thing.
 */

import type { SemanticRole } from '@termwright/protocol';

const ROLE_BY_CLASS: Readonly<Record<string, SemanticRole>> = Object.freeze({
  RootRenderable: 'application',
  TextRenderable: 'text',
  TextNodeRenderable: 'text',
  RootTextNodeRenderable: 'text',
  CodeRenderable: 'text',
  MarkdownRenderable: 'text',
  ASCIIFontRenderable: 'text',
  InputRenderable: 'textbox',
  TextareaRenderable: 'textbox',
  EditBufferRenderable: 'textbox',
  SelectRenderable: 'list',
  TextTableRenderable: 'table',
  ScrollBarRenderable: 'scrollbar',
});

/**
 * The role OpenTUI's class name implies, if any.
 *
 * @returns a role, or `undefined` when the class has no unambiguous
 * counterpart — `BoxRenderable`, `ScrollBoxRenderable`, `TabSelectRenderable`,
 * `SliderRenderable` and every application subclass land there on purpose.
 */
export function roleForOpenTuiClass(frameworkType: string): SemanticRole | undefined {
  return Object.hasOwn(ROLE_BY_CLASS, frameworkType) ? ROLE_BY_CLASS[frameworkType] : undefined;
}

/**
 * Whether a class is one of OpenTUI's own.
 *
 * Used to decide whether an unmapped `frameworkType` is a widget we chose not
 * to classify or an application's own subclass — a distinction worth keeping,
 * because the second is the case `generic` was designed for.
 */
export function isOpenTuiClass(frameworkType: string): boolean {
  return frameworkType.endsWith('Renderable');
}
