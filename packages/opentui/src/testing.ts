/**
 * `@termwright/opentui/testing` — component testing for OpenTUI.
 *
 * Kept off the adapter's root entry on purpose. This module imports
 * `@termwright/driver`, which carries a pty binary; the root entry must stay
 * installable in a production application that only wants to be instrumented.
 * See NOTES.md, "Why the mount lives on a subpath".
 *
 * **Requires Bun**, because `@opentui/core` loads its native library through
 * `bun:ffi`. Under Node, {@link mountOpenTui} fails immediately and says so.
 *
 * @packageDocumentation
 */

export { mountOpenTui } from './mount.js';
export type {
  MountOpenTuiOptions,
  MountOpenTuiRendererOptions,
  OpenTuiHarness,
  OpenTuiScene,
} from './mount.js';
