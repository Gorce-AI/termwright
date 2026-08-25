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
export { onRendererCreated, onRendererConfig, RENDERER_HOOK, CONFIG_HOOK } from './attach.js';
export type { ObservedRenderer, ObservedRuntimeCertification } from './attach.js';
export type { RuntimeCertification } from './certification.js';
export { detectRuntime, isInstrumented } from './runtime.js';
export type { EnvSource, ProbeRuntime } from './runtime.js';
export { buildShimSource, shouldShim, originalUrl, toModuleUrl, ORIGINAL_MARKER, OPENTUI_ENTRY_PATTERN } from './shim.js';
export { observeTree } from './observe.js';
export { createMarkerSink } from './sink.js';
export type { MarkerSink } from './sink.js';
export { startSession, probeInfo } from './session.js';
export { bootstrap } from './bootstrap.js';
export type { Bootstrap, BootstrapOptions } from './bootstrap.js';
export { connectProbe, ProbeChannel } from '@termwright/probe-runtime';
export type { ChannelSession, ConnectOptions } from '@termwright/probe-runtime';
export type { ObservableRenderer, Publisher, ProbeSession, SessionOptions } from './session.js';
export type { ObservableNode, ObserveOptions, Observation } from './observe.js';
export type { CommittedFrameGeometry, FrameGeometryProvider, InstrumentedRect } from './geometry.js';
