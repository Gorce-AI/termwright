/**
 * Low-level integration seams for framework adapters and Termwright's own
 * infrastructure. These exports may change before the stable driver API.
 *
 * Application tests should import from `@termwright/driver` instead.
 *
 * @packageDocumentation
 */

export { inheritedSpawnEnv } from './session.js';
export { launchTerminalWithBackend, type LaunchTerminalWithBackendOptions } from './session.js';
export { installTerminalLaunchResourceProvider } from './launch-resources.js';
export type {
  TerminalLaunchResourceLease,
  TerminalLaunchResourceProvider,
} from './launch-resources.js';

export {
  resolveDefaultPtyBackend,
  resetPtyBackendChoice,
  type PtyBackendChoice,
} from './backend-selection.js';
export {
  createNativePtyBackend,
  nativePtyAvailable,
  nativePtyUnavailableReason,
  NATIVE_PTY_BACKEND_NAME,
  type NativePtySessionHandle,
  type NativePtySpawn,
} from './native-pty-backend.js';
export type { PtyBackend, PtyProcess, PtySignal, PtySpawnOptions, PtyUnsubscribe } from './pty.js';
export {
  ProcessLifecycleError,
  type ProcessLifecycleErrorCode,
} from './internal/process-supervisor.js';

export { encodeKeys, encodePaste, encodeText, type KeyEncodingModes } from './keys.js';
export {
  encodeMouse,
  normalizeMouseModifiers,
  type MouseButton,
  type MouseEvent,
} from './mouse.js';
export {
  parseRef,
  semanticNodeId,
  parseSelector,
  textMatcher,
  type GenericQuery,
  type LocatorQuery,
  type ParsedRef,
  type RefQuery,
  type SemanticQuery,
  type SemanticStep,
  type StylePredicates,
  type TextMatcher,
} from './selectors.js';
