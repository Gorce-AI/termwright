/**
 * `@termwright/opentui` — the semantic adapter for OpenTUI.
 *
 * Call {@link instrumentRenderer} once, after creating the renderer, and when
 * a termwright driver is present the process publishes an addressable semantic
 * tree alongside its terminal output. When no driver is present the adapter is
 * inert, so the same build ships to production.
 *
 * The adapter never throws across its own boundary: every channel fault —
 * refused connection, malformed frame, driver gone — disables semantics and
 * leaves the application rendering untouched.
 *
 * @example
 * ```ts
 * import { createCliRenderer, BoxRenderable, TextRenderable } from '@opentui/core';
 * import { describeRenderable, instrumentRenderer } from '@termwright/opentui';
 *
 * const renderer = await createCliRenderer({ screenMode: 'alternate-screen' });
 * instrumentRenderer(renderer);
 *
 * const approve = new BoxRenderable(renderer, { id: 'approve', width: 11, height: 1 });
 * approve.add(new TextRenderable(renderer, { content: '[ Approve ]' }));
 * describeRenderable(approve, { role: 'button', name: 'Approve' });
 * renderer.root.add(approve);
 * ```
 *
 * @packageDocumentation
 */

export { describeRenderable, instrumentRenderer } from './instrument.js';
export type { RendererLike, SemanticOptions, SemanticSession } from './instrument.js';

export type { RenderableConvention, RenderableLike, SemanticMeta } from './types.js';

export { readAdapterEnv } from './config.js';
export type { AdapterEnv, EnvSource } from './config.js';

export { asSemanticRole, defaultActionsFor, mapRenderableClass } from './roles.js';

export { canPublishAbsoluteBounds } from './collect.js';
