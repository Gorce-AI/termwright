/**
 * `@termwright/ink` — the semantic adapter for Ink 7.
 *
 * Mount your app with {@link semanticRender} instead of `ink.render` and, when
 * a termwright driver is present, the process publishes an addressable
 * semantic tree alongside its terminal output. When no driver is present the
 * adapter is inert, so the same build ships to production.
 *
 * The adapter never throws across its own boundary: every channel fault —
 * refused connection, malformed frame, driver gone — disables semantics and
 * leaves the application rendering untouched.
 */

export { semanticRender, withSemantics } from './render.js';
export type { InkRenderFn, SemanticOptions, SemanticRenderOptions } from './render.js';
export { useSemantic } from './use-semantic.js';
export type { SemanticMeta } from './types.js';
export { readAdapterEnv } from './config.js';
export type { AdapterEnv, EnvSource } from './config.js';
export { mapInkAriaRole, defaultActionsForRole } from './roles.js';
export type { InkAriaRole } from './roles.js';
