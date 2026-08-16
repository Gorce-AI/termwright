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




// The Go machinery is shared with every other copy-based probe.
export * from '@termwright/probe-go';

export { recognize, roleFor, type RecognizeOptions } from './recognizer.js';

export {
  prepareInstrumentedBuild,
  CLIENT_MODULE,
  FRAMEWORK,
  PROBE_VERSION,
  type PrepareOptions,
  type PreparedBuild,
} from './launch.js';
