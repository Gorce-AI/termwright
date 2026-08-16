/**
 * `@termwright/probe-tview` — semantics from a tview application that imports
 * nothing of ours.
 *
 * The application is built through an ephemeral Go workspace that redirects
 * `github.com/rivo/tview` to an instrumented copy. The project's `go.mod`,
 * `go.sum` and any workspace of its own are never touched.
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
