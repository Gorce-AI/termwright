/**
 * `@termwright/probe-go` — the machinery every Go probe needs and none of them
 * should own.
 *
 * A language without a load-time seam needs a controlled compiler path. Exact
 * context patches use reproducible pristine copies and external workspaces;
 * add-only package units use Go's official `-toolexec` hook and never copy or
 * edit the dependency. Both paths bind owned source bytes to the build cache.
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

export { ensureUpstreamModule, type UpstreamModule } from './patches.js';

export {
  digestGoToolExecSource,
  GoToolExecError,
  prepareGoToolExec,
  type GoToolExecUnit,
  type PreparedGoToolExec,
  type PrepareGoToolExecOptions,
} from './toolexec.js';
