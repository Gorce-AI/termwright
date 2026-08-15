/**
 * The bridge between the structural view in `types.ts` and the real thing.
 *
 * The collector walks {@link RenderableLike} rather than OpenTUI's
 * `Renderable`, which is what makes it testable without the native library.
 * The cost of that choice is a claim — "every real renderable satisfies this"
 * — and this file is where the claim is checked, by the type checker, against
 * the installed `@opentui/core`. If OpenTUI renames `screenX` or drops
 * `getChildren`, `pnpm typecheck` fails here rather than in production.
 *
 * There is one runtime assertion, on the frame event's name, because a string
 * constant cannot be type-checked into correctness.
 */
import { expect, it } from 'vitest';
import { CliRenderEvents } from '@opentui/core';
import type { CliRenderer, Renderable } from '@opentui/core';
import type { RendererLike } from './instrument.js';
import type { RenderableLike } from './types.js';

// Structural conformance, checked at compile time. `Renderable` is abstract, so
// the assertion is on the type rather than on an instance.
type AssertAssignable<T extends U, U> = T;
type _RenderableIsRenderableLike = AssertAssignable<Renderable, RenderableLike>;
type _RendererIsRendererLike = AssertAssignable<CliRenderer, RendererLike>;

it('listens for the event OpenTUI announces a committed frame with', () => {
  expect(CliRenderEvents.FRAME).toBe('frame');
});
