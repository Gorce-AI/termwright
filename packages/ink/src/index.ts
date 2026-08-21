/**
 * `@termwright/ink` provides Ink annotations and component testing through one
 * public package.
 *
 * {@link mountInk} runs a component in the current process;
 * {@link launchInkFixture} runs a component in a real pseudo-terminal. Both
 * return the same terminal harness used by end-to-end tests.
 *
 * @example
 * ```tsx
 * import {mountInk, Semantic} from '@termwright/ink';
 *
 * const harness = await mountInk(
 *   <Semantic role="button" name="Approve"><Text>Approve</Text></Semantic>,
 * );
 * await harness.press('Enter');
 * await harness.close();
 * ```
 *
 * @packageDocumentation
 */

export { Semantic } from './semantic.js';
export type { SemanticChild, SemanticProps } from './semantic.js';
export { useSemantic } from './use-semantic.js';
export type { InkSemanticAnnotation } from './types.js';

export { mountInk } from './mount.js';
export type { InkHarness, MountInkOptions, MountInkRenderOptions } from './mount.js';

export { launchInkFixture } from './fixture.js';
export type { InkFixtureHarness, LaunchInkFixtureOptions } from './fixture.js';

export type { JsonProps, JsonValue } from './payload.js';
export type { SettleOptions } from './settle.js';
