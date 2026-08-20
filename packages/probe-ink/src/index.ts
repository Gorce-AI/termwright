/** `@termwright/probe-ink` — zero-config semantics for a normal Ink app. */

export { withProbe, PROBE_ENTRIES } from './launch.js';
export type { ProbeCommand } from './launch.js';
export { isInstrumented } from './runtime.js';
export type { EnvSource, ProbeRuntime } from './runtime.js';
export {
  buildShimSource,
  shouldShim,
  originalUrl,
  INK_ENTRY_PATTERN,
  INSTRUMENT_URL,
  ORIGINAL_MARKER,
} from './shim.js';
export { observeInkTree } from './observe.js';
export type { InkDomElement, InkDomNode, InkObservation, MeasureElement } from './observe.js';
export { canPublishInkGeometry } from './geometry.js';
export type { GeometryGateOptions } from './geometry.js';
export { createInkSession, probeInfo } from './session.js';
export type { InkProbeSession, InkSessionOptions } from './session.js';
