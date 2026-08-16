/**
 * `@termwright/probe-opentui` — semantics from an OpenTUI application that
 * imports nothing of ours.
 *
 * The application is launched with one extra flag; a module hook replaces
 * `@opentui/core`'s entry with a shim that wraps `createCliRenderer`, and the
 * probe observes the renderer's retained tree from there. Without the
 * instrumentation environment nothing is installed at all.
 */

export { withProbe, PROBE_ENTRIES } from './launch.js';
export type { ProbeCommand } from './launch.js';
export { onRendererCreated, RENDERER_HOOK } from './attach.js';
export type { ObservedRenderer } from './attach.js';
export { detectRuntime, isInstrumented } from './runtime.js';
export type { EnvSource, ProbeRuntime } from './runtime.js';
export { buildShimSource, shouldShim, originalUrl, ORIGINAL_MARKER, OPENTUI_ENTRY_PATTERN } from './shim.js';
