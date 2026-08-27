/**
 * `@termwright/probe-tview` — semantics from a tview application with one
 * public `tviewprobe.Attach` lifecycle call.
 *
 * Go's official `-toolexec` seam adds an owned compilation unit to tview's
 * package namespace. No upstream file is copied or edited, including in
 * vendor mode.
 *
 * @packageDocumentation
 */

// The Go compiler machinery is shared with every add-only Go probe.
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
