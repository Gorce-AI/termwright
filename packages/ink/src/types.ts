/**
 * Author-facing annotation types. These are the level-1 input of the normative
 * three-level role resolution (design §4.4): explicit annotation → framework
 * widget map → `generic`.
 */

import type { SemanticAction, SemanticRole, SemanticState } from '@termwright/protocol';

/**
 * Semantic description of one Ink `<Box>`.
 *
 * Everything is optional: annotating only a role, only a name, or only a
 * `testId` is valid and common. Unspecified facets fall back to what the
 * adapter can derive from the Ink element itself.
 */
export interface SemanticMeta {
  /** Explicit role. Wins over Ink's `aria-role` and over the widget map. */
  readonly role?: SemanticRole;
  /**
   * Accessible name. Wins over the element's rendered text, which is what the
   * adapter uses otherwise (Ink 7 does not retain `aria-label` on the node —
   * see NOTES.md).
   */
  readonly name?: string;
  /** Longer description, surfaced in failure diagnostics. */
  readonly description?: string;
  /** Current value of a value-bearing widget (textbox, progressbar). */
  readonly value?: string;
  /** Explicit states, merged over anything derived from `aria-state`. */
  readonly state?: SemanticState;
  /**
   * Action capabilities. Descriptive hints for locator strategies and
   * diagnostics — never callback endpoints. Overrides the role's defaults.
   */
  readonly actions?: readonly SemanticAction[];
  /** Author-supplied stable test id, matched by `getByTestId`. */
  readonly testId?: string;
  /**
   * The id this element's component passed to Ink's `useFocus({id})`.
   *
   * Ink publishes which focusable is active (`useFocusManager().activeId`) but
   * never says which element it belongs to. Naming the id here is what lets the
   * adapter derive `state.focused` from Ink's own flag instead of leaving it
   * unreported — `state.focused` still wins if you set it explicitly.
   */
  readonly focusId?: string;
}
