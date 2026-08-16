/**
 * `@termwright/probe-go` — the machinery every Go probe needs and none of them
 * should own.
 *
 * A language without a load-time seam has to compile a patched copy of the
 * framework, and that turns out to be three problems rather than one: pointing
 * the build at the copy without touching the project, keying the copy so a
 * stale one is never reused, and producing the copy reproducibly from a
 * pristine upstream. tview needed all three first; Charm and Ratatui need the
 * same three, unchanged.
 *
 * What stays in each probe is what is actually framework-specific: which
 * module to redirect, which patch set applies to which version, and what the
 * injected code reads.
 *
 * @packageDocumentation
 */

export {
  assertNoVendorMode,
  canaryCheck,
  readWorkspace,
  renderWorkspace,
  writeWorkspace,
  WorkspaceError,
  type InheritedWorkspace,
  type WorkspacePlan,
  type WorkspaceReplace,
  type WorkspaceUse,
} from './workspace.js';

export {
  cacheRoot,
  copyDir,
  copyKey,
  isComplete,
  markComplete,
  prepareCopyDir,
  pruneCache,
  stampPath,
  type CopyKeyInput,
} from './cache.js';

export {
  applyPatchSet,
  digestFile,
  digestPatchSet,
  materializeUpstream,
  PatchError,
  readManifest,
  verifyUpstream,
  writeProvenance,
  type AddedFile,
  type PatchedFile,
  type PatchManifest,
} from './patches.js';
