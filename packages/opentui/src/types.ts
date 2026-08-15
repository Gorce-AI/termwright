/**
 * The structural view the adapter takes of OpenTUI, plus the author-facing
 * annotation type.
 *
 * The collector deliberately walks {@link RenderableLike} rather than
 * `@opentui/core`'s `Renderable`. Two reasons, both practical: the real class
 * cannot be instantiated without the native Zig library (which currently loads
 * under Bun only — see NOTES.md), so a structural view is what makes the
 * collector unit-testable at all; and the adapter reads eight members out of a
 * class with several hundred, which is worth stating in one place.
 *
 * Every real `Renderable` satisfies {@link RenderableLike}. The assertion that
 * this stays true lives in `opentui-types.test.ts`, which type-checks a real
 * `Renderable` against it.
 */

import type { SemanticAction, SemanticRole, SemanticState } from '@termwright/protocol';

/**
 * What the collector reads from an OpenTUI `Renderable`.
 *
 * The optional members are the per-widget facets: they exist on some
 * renderable classes and not on others, and the collector treats every one of
 * them as "use it if it is there".
 */
export interface RenderableLike {
  /** Author-assigned or generated element id. Doubles as the `testId`. */
  readonly id: string;
  /** OpenTUI's process-wide instance counter — stable for the object's life. */
  readonly num: number;
  readonly visible: boolean;
  /** Viewport column of the renderable's top-left cell. */
  readonly screenX: number;
  /** Viewport row of the renderable's top-left cell. */
  readonly screenY: number;
  readonly width: number;
  readonly height: number;
  readonly focusable: boolean;
  readonly focused: boolean;
  getChildren(): readonly RenderableLike[];

  /** Rendered text, on the text-bearing renderables (`Text`, `Input`, …). */
  readonly plainText?: string;
  /** Current value of a value-bearing renderable (`Input`, `Textarea`). */
  readonly value?: unknown;
  /** Box title, used as an accessible name when nothing better exists. */
  readonly title?: unknown;
  readonly placeholder?: unknown;
  readonly disabled?: unknown;
  /** `Select` / `TabSelect`: the option currently under the cursor. */
  getSelectedOption?(): { readonly name?: unknown } | null;
}

/**
 * The convention properties an application may set directly on a renderable,
 * as an alternative to {@link describeRenderable}.
 *
 * OpenTUI's `Renderable` constructor drops options it does not know, so a role
 * cannot be passed as a construction prop (verified against 0.5.3 — see
 * NOTES.md). Assigning after construction works, and is what a reconciler
 * `ref` callback does anyway.
 *
 * @example
 * ```ts
 * const approve = new BoxRenderable(renderer, { id: 'approve' });
 * approve.role = 'button';
 * approve.semanticName = 'Approve';
 * ```
 */
export interface RenderableConvention {
  readonly role?: unknown;
  readonly semanticName?: unknown;
  readonly ariaLabel?: unknown;
  readonly testId?: unknown;
}

/**
 * Semantic description of one renderable.
 *
 * Everything is optional: annotating only a role, only a name, or only a
 * `testId` is valid and common. Unspecified facets fall back to what the
 * adapter can derive from the renderable itself.
 */
export interface SemanticMeta {
  /** Explicit role. Wins over the convention property and over the class map. */
  readonly role?: SemanticRole;
  /** Accessible name. Wins over the renderable's rendered text. */
  readonly name?: string;
  /** Longer description, surfaced in failure diagnostics. */
  readonly description?: string;
  /** Current value of a value-bearing widget (textbox, progressbar). */
  readonly value?: string;
  /** Explicit states, merged over anything derived from the renderable. */
  readonly state?: SemanticState;
  /**
   * Action capabilities. Descriptive hints for locator strategies and
   * diagnostics — never callback endpoints. Overrides the role's defaults.
   */
  readonly actions?: readonly SemanticAction[];
  /** Author-supplied stable test id, matched by `getByTestId`. */
  readonly testId?: string;
}
