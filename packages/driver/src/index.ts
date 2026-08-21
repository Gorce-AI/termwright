/**
 * `@termwright/driver` — PTY + VT sessions, locators, actions and waits.
 *
 * The normative public API lives in `api.ts`; this module is the only entry
 * point and re-exports the types from there together with their runtime
 * implementations.
 *
 * @example
 * ```ts
 * import { launchTerminal } from '@termwright/driver';
 *
 * const terminal = await launchTerminal({ command: ['node', 'app.js'] });
 * await terminal.waitForText('Ready');
 * await terminal.getByRole('button', { name: 'Approve' }).activate();
 * await terminal.close();
 * ```
 */

// Normative types (api.ts declares the contract; the values live below).
export type {
  ActivateReceipt,
  CellAttributes,
  CellColor,
  ActionEvent,
  ActionStartedEvent,
  AppLogEvent,
  AppLogSource,
  CellSnapshot,
  CrashInput,
  CrashReport,
  DiagnosticCode,
  EnvMode,
  ErrorDiagnostics,
  ExitStatus,
  LaunchOptions,
  Locator,
  LocatorCellSnapshot,
  LocatorCellSnapshotOptions,
  PointerOptions,
  RecordingOptions,
  ResizeReceipt,
  ResolvedTarget,
  BoundsExpectation,
  SpatialRelationExpectation,
  RoleLocatorOptions,
  ScreenSnapshot,
  ShellApi,
  ShellCommandResult,
  ShellRunOptions,
  ShellStatus,
  ScrollbackApi,
  SelectionApi,
  SessionCapabilities,
  SessionDiagnostic,
  SessionEventMap,
  SessionEvents,
  TerminalHarness,
  TerminalModes,
  TermwrightErrorCode,
  TextLocatorOptions,
  TimeoutClasses,
  WaitOptions,
} from './api.js';

export { launchTerminal, type LaunchTerminalOptions } from './session.js';
export { debugMode, type DebugCategory } from './debug.js';

export {
  AmbiguousLocatorError,
  CapacityError,
  HistoryTruncatedError,
  NotFoundError,
  ProcessExitedError,
  ProtocolViolationError,
  SessionClosedError,
  StaleSnapshotError,
  TermwrightError,
  TimeoutError,
  UnsupportedActionError,
} from './errors.js';

export {
  createNodePtyBackend,
  type PtyBackend,
  type PtyProcess,
  type PtySignal,
  type PtySpawnOptions,
  type PtyUnsubscribe,
} from './pty.js';

export { encodeKeys, encodePaste, encodeText, type KeyEncodingModes } from './keys.js';
export { encodeMouse, type MouseButton, type MouseEvent } from './mouse.js';
export {
  parseRef,
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
