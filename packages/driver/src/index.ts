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
  CellAttributes,
  CellColor,
  CellLink,
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
  Keyboard,
  AnyLocator,
  LocatorForDomain,
  SemanticLocator,
  ScreenLocator,
  LocatorCellSnapshot,
  LocatorCellSnapshotOptions,
  LocatorDragOptions,
  SemanticLocatorFilterOptions,
  ScreenLocatorFilterOptions,
  LocatorWheelOptions,
  MouseModifier,
  MouseModifierOptions,
  PointerOptions,
  Mouse,
  MousePoint,
  OperationBudget,
  RecordingOptions,
  ResizeReceipt,
  ResolvedTarget,
  BoundsExpectation,
  SpatialRelationExpectation,
  RoleLocatorOptions,
  ScreenTextLocatorOptions,
  ScreenSnapshot,
  ShellApi,
  ShellCommandResult,
  ShellRunOptions,
  ShellStatus,
  ScrollbackApi,
  SelectionApi,
  SessionDiagnostic,
  SessionEventMap,
  SessionEventGap,
  SessionEventRecord,
  SessionEventSubscriptionOptions,
  SessionEvents,
  TerminalHarness,
  TerminalWindow,
  TerminalState,
  TerminalStateSnapshot,
  TerminalModes,
  TermwrightErrorCode,
  TextLocatorOptions,
  TimeoutClasses,
  WaitOptions,
} from './api.js';

// These protocol-owned types are part of the driver's public planning and
// observation surface. Re-export them here so users never need a transitive
// @termwright/protocol import merely to name a value returned by the driver.
export type {
  ActionIntent,
  ActionKind,
  ActionPlan,
  ActionReceipt,
  ActionabilityExplanation,
  Condition,
  ConditionResult,
  ExecutableDeviceOperation,
  RecordedDeviceOperation,
  ArtifactValuePolicy,
  ExecutableValue,
  PublicValue,
  RecordedValue,
  SemanticValueObservation,
  SensitiveValue,
  EffectiveSessionContract,
  EvidenceProvenance,
  Observation,
  ObservationStamp,
  PhysicalRegion,
  SessionCapabilityId,
  LocatorDomain,
  LocatorRef,
  SemanticLocatorRef,
  ScreenLocatorRef,
  ScreenCondition,
} from '@termwright/protocol';

export { launchTerminal, type LaunchTerminalOptions } from './session.js';
export { installTerminalLaunchResourceProvider } from './launch-resources.js';
export type {
  TerminalLaunchResourceLease,
  TerminalLaunchResourceProvider,
} from './launch-resources.js';
export { publicValue, sensitive } from '@termwright/protocol';
export { debugMode, type DebugCategory } from './debug.js';

export {
  AmbiguousLocatorError,
  AdapterGuaranteeViolationError,
  DuplicateSemanticKeyError,
  CapabilityProviderLostError,
  CapabilityProviderViolationError,
  EvidenceConflictError,
  CapabilityUnavailableError,
  CapacityError,
  HistoryTruncatedError,
  InputModeDisabledError,
  NotFoundError,
  NotActionableError,
  ProbeAttachFailedError,
  ProcessExitedError,
  PtyBackendError,
  ProtocolViolationError,
  SessionClosedError,
  SemanticCapabilityUnavailableError,
  StaleSnapshotError,
  TermwrightError,
  TimeoutError,
} from './errors.js';

export {
  createNodePtyBackend,
  type PtyBackend,
  type PtyProcess,
  type PtySignal,
  type PtySpawnOptions,
  type PtyUnsubscribe,
} from './pty.js';

export {
  ProcessLifecycleError,
  type ProcessLifecycleErrorCode,
} from './internal/process-supervisor.js';

export { encodeKeys, encodePaste, encodeText, type KeyEncodingModes } from './keys.js';
export { encodeMouse, normalizeMouseModifiers, type MouseButton, type MouseEvent } from './mouse.js';
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
