/**
 * Session core: `launchTerminal` and the {@link TerminalHarness} it returns.
 *
 * One session owns one PTY, one headless emulator, one semantic endpoint and
 * one revision timeline. Everything observable is revision-stamped, and every
 * wait is driven by revisions or process events — the driver never sleeps.
 */
import { existsSync } from 'node:fs';
import type { TerminalProfileId } from '@termwright/vt';
import type {
  ActionEvent,
  AppLogEvent,
  AppLogSource,
  CellSnapshot,
  CrashReport,
  DiagnosticCode,
  EnvMode,
  SessionDiagnostic,
  ExitStatus,
  ErrorDiagnostics,
  LaunchOptions,
  LocatorRef,
  SemanticLocator,
  ScreenLocator,
  Keyboard,
  Mouse,
  MousePoint,
  ResolvedTarget,
  RoleLocatorOptions,
  ScreenSnapshot,
  ShellApi,
  ShellCommandResult,
  ScrollbackApi,
  SelectionApi,
  SessionEvents,
  TerminalHarness,
  TerminalModes,
  TerminalState,
  TerminalWindow,
  TextLocatorOptions,
  ScreenTextLocatorOptions,
  TimeoutClasses,
  OperationBudget,
  WaitOptions,
} from './api.js';
import type {
  ActionIntent,
  ExecutableActionPlan,
  ActionReceipt,
  ResolvedArtifactSecurityPolicy,
  ExecutableDeviceOperation,
  ExecutableValue,
  EffectiveSessionContract,
  EvidenceProvenance,
  LogRecord,
  Observation,
  ObservationStamp,
  PointerHitGrid,
  ProviderTerminalInputModes,
  SemanticNode,
  SemanticRole,
  SemanticSnapshot,
  SessionCapabilityId,
} from '@termwright/protocol';
import {
  resolveArtifactSecurityPolicy,
  ABSOLUTE_LIMITS,
  DEFAULT_LIMITS,
  DEFAULT_NEGOTIATION_MS,
  ENV_ENDPOINT,
  ENV_TOKEN,
  generateToken,
  executableText,
  capabilityRemediation,
  recordActionPlan,
  recordDeviceOperation,
  verifyMarkerPayload,
  createRunId,
} from '@termwright/protocol';
import {
  TermwrightError,
  AdapterGuaranteeViolationError,
  DuplicateSemanticKeyError,
  CapabilityProviderLostError,
  CapabilityProviderViolationError,
  EvidenceConflictError,
  CapabilityUnavailableError,
  HistoryTruncatedError,
  InputModeDisabledError,
  ProbeAttachFailedError,
  ProtocolViolationError,
  ProcessExitedError,
  PtyBackendError,
  SessionClosedError,
  StaleSnapshotError,
  TimeoutError,
  NotFoundError,
} from './errors.js';
import { DebugLog, debugMode, formatBytes, instrument } from './debug.js';
import { SessionEventEmitter } from './events.js';
import { LogTailer } from './logs.js';
import { encodeFocus, encodeKeys, encodePaste, encodeText } from './keys.js';
import { LocatorImpl, type LocatorContext } from './locator.js';
import { assertBeforeActionInput } from './internal/action-retry.js';
import { Deadline } from './internal/deadline.js';
import { waitForQuiet } from './internal/quiet.js';
import {
  SessionEvidenceJournal,
  type SessionDiagnosticContext,
} from './internal/session-evidence.js';
import { SessionActionLifecycle } from './internal/session-actions.js';
import { SessionProcessLifecycle } from './internal/session-process-lifecycle.js';
import { SessionInputEvidenceBarrier } from './internal/session-input-plane.js';
import { buildSessionContract } from './internal/session-semantic-plane.js';
import { ResourceCleanupError, ResourceScope } from './internal/resource-scope.js';
import {
  acquireTerminalLaunchResourceLease,
  type TerminalLaunchResourceLease,
} from './launch-resources.js';
import { ProcessLifecycleError, ProcessSupervisor } from './internal/process-supervisor.js';
import { encodeMouse, normalizeMouseModifiers, type MouseEvent } from './mouse.js';
import { SemanticIndex, textInRect } from './matching.js';
import { RevisionPairing } from './pairing.js';
import { resolveDefaultPtyBackend } from './backend-selection.js';
import { type PtyBackend, type PtyProcess } from './pty.js';
import {
  captureCell,
  captureRows,
  captureText,
  captureScreen,
  screenExcerpt,
  type CapturedRow,
} from './screen.js';
import { SemanticChannel, type SemanticAttachment } from './semantic.js';
import { composeProviderEvidence } from './provider-evidence.js';
import { ShellCommandTracker } from './shell.js';
import {
  integratedPowerShellCommand,
  posixShellBootstrap,
  wrapPosixShellCommand,
  wrapPowerShellCommand,
} from './shell-integration.js';

import {
  gridQuery,
  labelQuery,
  parseRef,
  parseSelector,
  refQuery,
  roleQuery,
  textMatcher,
  textQuery,
  type StylePredicates,
} from './selectors.js';
import { VtScreen } from './vt.js';

/** Defaults for the timeout classes (design §5.3). */
const DEFAULT_TIMEOUTS: Required<TimeoutClasses> = Object.freeze({
  action: 5_000,
  text: 5_000,
  idle: 2_000,
  ready: 10_000,
  exit: 10_000,
});

/** Environment overrides, e.g. `TERMWRIGHT_TIMEOUT_ACTION=15000`. */
const TIMEOUT_ENV: Readonly<Record<keyof TimeoutClasses, string>> = Object.freeze({
  action: 'TERMWRIGHT_TIMEOUT_ACTION',
  text: 'TERMWRIGHT_TIMEOUT_TEXT',
  idle: 'TERMWRIGHT_TIMEOUT_IDLE',
  ready: 'TERMWRIGHT_TIMEOUT_READY',
  exit: 'TERMWRIGHT_TIMEOUT_EXIT',
});

/** Explicit quiet window used only where the caller asks for heuristic silence. */
const READY_QUIET_MS = 150;

/** Quiet window that counts as idle output. */
const IDLE_QUIET_MS = 100;

/** Diagnostic window for a half-paired revision; never a publication deadline. */
const PAIRING_TIMEOUT_MS = 1_000;

/**
 * Budget offered to an adapter that announced the `logs` capability.
 *
 * The adapter enforces it at the source — that is what keeps a log storm from
 * eating the frame budget the semantic tree needs — and the driver enforces the
 * same ceiling again on arrival, because a budget only the sender honours is
 * not a budget.
 */
const LOG_RECORDS_PER_SECOND = 200;
const LOG_BURST = 500;

/** Window the driver-side record limiter counts in. */
const LOG_WINDOW_MS = 250;

/**
 * Upper bound on how long `close()` waits for the child to hang up.
 *
 * Was raised for Windows while "did not report a real exit" looked like a slow
 * console host. It was not slow: teardown inspected the tree before ConPTY had
 * attached, so it killed nothing and waited for an exit that could not come.
 * With that fixed the extra budget bought nothing and cost something — close()
 * has a caller with a budget of its own, and stacking waits inside it turned
 * one slow teardown into a timed-out hook.
 */
export const CLOSE_GRACE_MS = 2_000;

/** Stable application-facing options accepted by {@link launchTerminal}. */
export interface LaunchTerminalOptions extends LaunchOptions {
  /**
   * Whether the child's input-mode requests are observable. Defaults to true
   * for every certified backend, including pinned passthrough ConPTY. Set false
   * only for an embedding or synthetic backend that cannot expose DECSET.
   */
  readonly modesObservable?: boolean;
}

/** Low-level integration options exported only from `@termwright/driver/experimental`. */
export interface LaunchTerminalWithBackendOptions extends LaunchTerminalOptions {
  readonly backend: PtyBackend;
}

function resolveTimeouts(overrides: TimeoutClasses | undefined): Required<TimeoutClasses> {
  const out: Record<string, number> = { ...DEFAULT_TIMEOUTS };
  for (const [key, variable] of Object.entries(TIMEOUT_ENV)) {
    const raw = process.env[variable];
    if (raw === undefined) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) out[key] = parsed;
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value;
  }
  return Object.freeze(out) as Required<TimeoutClasses>;
}

/**
 * Launches a program in a real PTY and returns a harness over it.
 *
 * The semantic endpoint is created *before* the child starts, so an
 * instrumented application can hand over its first tree during startup. An
 * uninstrumented application simply never connects: after
 * `semanticNegotiationMs` adapter discovery closes and the session settles as
 * generic (`semanticTree: false`). A peer accepted before that boundary keeps
 * only its own bounded hello deadline before the same fail-closed outcome.
 *
 * @example
 * ```ts
 * const terminal = await launchTerminal({ command: ['node', 'app.js'] });
 * await terminal.waitForText('ready');
 * await terminal.press('Control+C');
 * await terminal.close();
 * ```
 */
export async function launchTerminal(options: LaunchTerminalOptions): Promise<TerminalHarness> {
  const admission = await prepareTerminalLaunch(options);
  let backend: PtyBackend;
  try {
    backend = (await resolveDefaultPtyBackend()).backend;
  } catch (error) {
    await rollbackLaunchAdmission(admission.lease, error);
    throw error;
  }
  return launchAdmittedTerminal({ ...options, backend }, admission);
}

/** Launches through an explicitly owned PTY backend for framework integrations. */
export function launchTerminalWithBackend(
  options: LaunchTerminalWithBackendOptions,
): Promise<TerminalHarness> {
  // Return the admission continuation itself. An async wrapper creates a
  // second adoption promise before admission has settled; when admission
  // rejects at the launch deadline that wrapper has no independent lifecycle
  // to cancel and is reported as a leaked startup operation.
  return prepareTerminalLaunch(options).then((admission) =>
    launchAdmittedTerminal(options, admission),
  );
}

async function prepareTerminalLaunch(options: LaunchTerminalOptions): Promise<{
  readonly deadline: Deadline;
  readonly lease: TerminalLaunchResourceLease | null;
}> {
  if (options.command.length === 0) {
    throw new TypeError('launchTerminal requires a non-empty command');
  }
  resolveSemanticFrameQueueCapacity(options.semanticFrameQueueCapacity);
  const launchTimeout =
    options.operationBudget?.remaining(resolveTimeouts(options.timeouts).ready, 'launchTerminal') ??
    resolveTimeouts(options.timeouts).ready;
  const launchDeadline = Deadline.after(launchTimeout);
  // The native host admits scarce resources before the semantic endpoint or
  // PTY exists. Standalone driver processes can install their own owner.
  const lease = await acquireTerminalLaunchResourceLease();
  return { deadline: launchDeadline, lease };
}

function resolveSemanticFrameQueueCapacity(value: number | undefined): number {
  const capacity = value ?? DEFAULT_LIMITS.maxQueuedFrames;
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > ABSOLUTE_LIMITS.maxQueuedFrames
  ) {
    throw new TypeError(
      `semanticFrameQueueCapacity must be an integer from 1 to ${ABSOLUTE_LIMITS.maxQueuedFrames}`,
    );
  }
  return capacity;
}

async function rollbackLaunchAdmission(
  lease: TerminalLaunchResourceLease | null,
  error: unknown,
): Promise<void> {
  if (lease === null) return;
  try {
    await lease.release();
  } catch (releaseError) {
    throw new AggregateError(
      [error, releaseError],
      'terminal validation and admission rollback failed',
      { cause: error },
    );
  }
}

async function launchAdmittedTerminal(
  options: LaunchTerminalWithBackendOptions,
  admission: {
    readonly deadline: Deadline;
    readonly lease: TerminalLaunchResourceLease | null;
  },
): Promise<TerminalHarness> {
  const launchDeadline = admission.deadline;
  const launchLease = admission.lease;
  let session: TerminalSession;
  try {
    session = new TerminalSession(options, launchLease);
  } catch (error) {
    await rollbackLaunchAdmission(launchLease, error);
    throw error;
  }
  if (launchLease !== null) {
    try {
      await launchLease.attach(session.sessionId);
    } catch (error) {
      try {
        await session.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'terminal admission attachment and rollback failed',
          { cause: error },
        );
      }
      throw error;
    }
  }
  if (launchDeadline.expired()) {
    const failure = new TimeoutError(
      'terminal launch exhausted its total ready budget during resource admission',
      session.errorDiagnostics(),
    );
    try {
      await session.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [failure, cleanupError],
        'terminal launch deadline and rollback failed',
        { cause: failure },
      );
    }
    throw failure;
  }
  await session.start(launchDeadline);
  try {
    if ((options.requiredCapabilities?.length ?? 0) > 0) {
      await session.awaitLaunchNegotiation(launchDeadline);
      const contract = session.contract();
      if (contract === null) throw new Error('session negotiation settled without a contract');
      const required = [...new Set(options.requiredCapabilities)];
      const available = Object.entries(contract.capabilities)
        .filter(([, value]) => value.status === 'supported')
        .map(([id]) => id);
      const missing = required.filter((id) => contract.capabilities[id].status !== 'supported');
      if (missing.length > 0) {
        const framework =
          contract.framework === null
            ? 'generic terminal session'
            : `${contract.framework.name}@${contract.framework.version}`;
        const remediationHint = [
          ...new Set(missing.map((id) => capabilityRemediation(`session.${id}`).message)),
        ].join(' ');
        const attachFailed = contract.framework === null && missing.includes('semantic-tree');
        throw attachFailed
          ? new ProbeAttachFailedError(
              `semantic integration was required, but no probe attached before negotiation settled; ` +
                `required=[${required.join(', ')}] available=[${available.join(', ')}]`,
              session.errorDiagnostics({
                suggestion:
                  'launch through the certified framework integration; for Python do not use -S/-E and verify the sitecustomize bootstrap can attach',
              }),
            )
          : new CapabilityUnavailableError(
              `launch requirements were not met; required=[${required.join(', ')}] ` +
                `available=[${available.join(', ')}] missing=[${missing.join(', ')}] ` +
                `framework=${framework}`,
              session.errorDiagnostics({ suggestion: remediationHint }),
            );
      }
    }
  } catch (error) {
    try {
      await session.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'terminal launch requirements and rollback failed',
        { cause: error },
      );
    }
    throw error;
  }
  const log = session.debugLog;
  return log === null ? session : instrument<TerminalHarness>(session, log, 'harness');
}

interface ChangeWaiter {
  resolve(): void;
  timer: NodeJS.Timeout;
}

class TerminalSession implements TerminalHarness, LocatorContext {
  readonly sessionId = createRunId('session');
  readonly shell: ShellApi;
  readonly keyboard: Keyboard;
  readonly mouse: Mouse;
  readonly window: TerminalWindow;
  readonly terminalState: TerminalState;
  readonly timeouts: Required<TimeoutClasses>;
  readonly artifactSecurity: ResolvedArtifactSecurityPolicy;
  readonly events: SessionEvents;
  readonly scrollback: ScrollbackApi;
  readonly selection: SelectionApi;

  readonly #options: LaunchTerminalWithBackendOptions;
  readonly #emitter: SessionEventEmitter;
  readonly #vt: VtScreen;
  readonly #backend: PtyBackend;
  readonly #token = generateToken();
  readonly #pairing: RevisionPairing;
  readonly #evidence: SessionEvidenceJournal;
  readonly #actions: SessionActionLifecycle;
  readonly #lifecycle = new SessionProcessLifecycle();
  readonly #inputEvidence = new SessionInputEvidenceBarrier();
  readonly #changeWaiters = new Set<ChangeWaiter>();
  readonly #startedAt = performance.now();
  readonly #resources = new ResourceScope('terminal session');
  readonly #launchLease: TerminalLaunchResourceLease | null;
  readonly #protocolLimits: typeof DEFAULT_LIMITS;

  #channel: SemanticChannel | null = null;
  #pty: PtyProcess | null = null;
  #detachTerminalResponse: (() => void) | null = null;
  #terminalResponseAdmissionOpen = false;
  #lateTerminalResponseLogged = false;
  #processSupervisor: ProcessSupervisor | null = null;
  #attachment: SemanticAttachment | null = null;
  #index: SemanticIndex | null = null;
  #contract: EffectiveSessionContract | null = null;
  #settled = false;
  #settleWaiters: (() => void)[] = [];
  #negotiationTimer: NodeJS.Timeout | null = null;
  #closed = false;
  #closePromise: Promise<void> | null = null;
  #exitProcessing: Promise<void> | null = null;
  #lastOutputAt = performance.now();
  #violation: ProtocolViolationError | null = null;
  #providerFailure: TermwrightError | null = null;
  #ptyFailure: PtyBackendError | null = null;
  #providerInputModes: ProviderTerminalInputModes | null = null;
  #providerComposedNodeIds: ReadonlySet<string> = new Set();
  #crash: CrashReport | null = null;
  /** The in-flight evidence wait, shared by every pending pairing half. */
  #settling: Promise<void> | null = null;
  /** Modes already reported as unverifiable; each is logged once per session. */
  readonly #unverifiableLogged = new Set<'mouse' | 'focus'>();
  #debug: DebugLog | null = null;
  #logs: LogTailer | null = null;
  /** Wall clock and session clock as they stood at the handshake. */
  #clockAnchor: { epochMs: number; sessionMs: number } | null = null;
  #logWindowStartedAt = 0;
  #logWindowRecords = 0;
  #logDroppedInWindow = 0;
  #logDropTimer: NodeJS.Timeout | null = null;
  #lastLogSeq: number | null = null;
  #selectionRange: {
    start: { row: number; column: number };
    end: { row: number; column: number };
  } | null = null;
  #observationSequence = 0;
  readonly #shellTracker = new ShellCommandTracker();
  #operationBudget: OperationBudget | undefined;
  #ownedProcessResources: import('./api.js').OwnedProcessResourceUsage | null = null;

  constructor(
    options: LaunchTerminalWithBackendOptions,
    launchLease: TerminalLaunchResourceLease | null = null,
  ) {
    this.#options = options;
    this.#launchLease = launchLease;
    this.#protocolLimits = Object.freeze({
      ...DEFAULT_LIMITS,
      maxQueuedFrames: resolveSemanticFrameQueueCapacity(options.semanticFrameQueueCapacity),
    });
    this.#operationBudget = options.operationBudget;
    this.timeouts = resolveTimeouts(options.timeouts);
    this.artifactSecurity = resolveArtifactSecurityPolicy(options.artifactSecurity);
    this.#emitter = new SessionEventEmitter((error) =>
      this.#diagnostic('listener-error', `a session event listener threw: ${String(error)}`),
    );
    this.#evidence = new SessionEvidenceJournal({
      now: () => this.#now(),
      diagnostic: (entry) => this.#emitter.emit('diagnostic', entry),
      appLog: (entry) => this.#emitter.emit('app-log', entry),
    });
    this.#actions = new SessionActionLifecycle({
      isOpen: () => !this.#closed,
      now: () => this.#now(),
      checkpoint: () => this.checkpoint(),
      started: (event) => this.#emitter.emit('action-start', event),
      finished: (event) => this.#emitter.emit('action', event),
    });
    this.events = this.#emitter;
    this.#backend = options.backend;
    this.#vt = new VtScreen({
      columns: options.columns ?? 100,
      rows: options.rows ?? 30,
      scrollbackLines: options.scrollbackLines ?? 2_000,
      ...(options.terminalProfile !== undefined ? { profile: options.terminalProfile } : {}),
      ...(options.modesObservable !== undefined
        ? { modesObservable: options.modesObservable }
        : {}),
    });
    this.#resources.defer('virtual terminal', () => this.#vt.dispose());
    this.#pairing = new RevisionPairing({
      maxPending: this.#protocolLimits.maxQueuedFrames,
      pairingTimeoutMs: PAIRING_TIMEOUT_MS,
      caughtUp: () => this.#evidenceSettled(),
      onPublish: (paired) => this.#publishSemantic(paired.snapshot, paired.changedNodes),
      onDiagnostic: (code, detail, revision) => this.#diagnostic(code, detail, { revision }),
    });
    this.#resources.defer('revision pairing', () => this.#pairing.dispose());
    this.scrollback = this.#createScrollbackApi();
    this.selection = this.#createSelectionApi();
    this.shell = Object.freeze<ShellApi>({
      status: () => this.#shellStatus(),
      waitForPrompt: (opts) => this.#waitForShellPrompt(opts),
      run: (command, opts) => this.#runShellCommand(command, opts),
    });
    this.keyboard = Object.freeze<Keyboard>({
      press: (keys) => this.#keyboardPress(keys),
      type: (text) => this.#keyboardType(text),
      paste: (text) => this.#keyboardPaste(text),
    });
    this.mouse = Object.freeze<Mouse>({
      move: (point) =>
        this.#mouseEvents('mouse.move', [{ kind: 'move', ...this.#mousePoint(point) }]),
      down: (point) =>
        this.#mouseEvents('mouse.down', [
          {
            kind: 'press',
            button: point.button ?? 'left',
            ...this.#mousePoint(point),
          },
        ]),
      up: (point) =>
        this.#mouseEvents('mouse.up', [
          {
            kind: 'release',
            button: point.button ?? 'left',
            ...this.#mousePoint(point),
          },
        ]),
      click: (point) => this.#mouseClick(point),
      wheel: (options) => this.#mouseWheel(options),
      drag: (options) => this.#mouseDrag(options),
    });
    this.window = Object.freeze<TerminalWindow>({
      focus: () => this.#windowFocus(true),
      blur: () => this.#windowFocus(false),
    });
    this.terminalState = Object.freeze<TerminalState>({
      snapshot: () => this.#terminalState(),
    });

    const mode = debugMode(options.debug);
    if (mode !== 'off') {
      this.#debug = new DebugLog(this.sessionId, () => this.#now(), mode);
      this.#installDebugListeners();
    }
  }

  bindOperationBudget(budget: OperationBudget): void {
    if (this.#operationBudget !== undefined && this.#operationBudget !== budget) {
      throw new Error('terminal session already belongs to a different operation budget');
    }
    this.#operationBudget = budget;
  }

  operationTimeout(requestedMs: number, operation: string): number {
    return this.#operationBudget?.remaining(requestedMs, operation) ?? requestedMs;
  }

  /** The debug log, when one is enabled; `launchTerminal` instruments with it. */
  get debugLog(): DebugLog | null {
    return this.#debug;
  }

  /** Creates the endpoint, spawns the child and starts the negotiation window. */
  async start(deadline: Deadline): Promise<void> {
    try {
      await this.#startResources(deadline);
    } catch (error) {
      try {
        await this.close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'terminal startup and rollback failed', {
          cause: error,
        });
      }
      throw error;
    }
  }

  async #startResources(deadline: Deadline): Promise<void> {
    const negotiationMs =
      this.#options.semanticNegotiationMs ??
      ((this.#options.requiredCapabilities?.length ?? 0) > 0
        ? Math.max(DEFAULT_NEGOTIATION_MS, this.timeouts.ready)
        : DEFAULT_NEGOTIATION_MS);
    this.#channel = await this.#resources.acquire(
      'semantic channel',
      () =>
        SemanticChannel.listen({
          sessionId: this.sessionId,
          token: this.#token,
          limits: this.#protocolLimits,
          acceptHello: () => this.semanticPossible(),
          logBudget: {
            maxRecordsPerSecond: LOG_RECORDS_PER_SECOND,
            burst: LOG_BURST,
          },
          handshakeTimeoutMs: negotiationMs,
          hooks: {
            onAttach: (attachment) => this.#onAttach(attachment),
            onNegotiationStateChange: (state) => {
              if (!state.admissionOpen && state.pendingHandshakes === 0) {
                this.#settleGenericAfterDiscovery(negotiationMs);
              }
            },
            onDisconnect: () => {
              if (this.#closed || this.#lifecycle.teardownRequested || this.#attachment === null)
                return;
              this.#providerFailure = new CapabilityProviderLostError(
                `semantic capability provider ${this.#attachment.adapter.name} disconnected after negotiation`,
                this.errorDiagnostics({
                  suggestion:
                    'restart the application; a frozen session contract cannot silently downgrade',
                }),
              );
              this.#notifyChange();
            },
            onSnapshot: (snapshot, changedNodes) => {
              this.#pairing.offerSnapshot(snapshot, changedNodes);
              this.#notifyChange();
            },
            onLogRecord: (record) => this.#publishLogRecord(record),
            onCommit: (revision) => {
              // FRAME_END in the probe lifecycle: the frame this revision was
              // drawn in is over, whether or not its beginning was announced.
              this.#pairing.frameClosed(revision);
              this.#notifyChange();
              this.#diagnostic(
                'revision-commit',
                `the adapter reported committing revision ${revision}; pairing still waits for its render marker`,
                { revision },
              );
            },
            onFrameBegin: (revision) => {
              this.#pairing.frameOpened(revision);
              this.#notifyChange();
            },
            onDiagnostic: (code, detail, about) => this.#diagnostic(code, detail, about),
            onProtocolViolation: (error, wireCode) => {
              this.#violation =
                wireCode === 'duplicate-semantic-key'
                  ? new DuplicateSemanticKeyError(
                      error.message,
                      this.errorDiagnostics({
                        suggestion:
                          'make every explicit SemanticKey unique in the committed application tree',
                      }),
                    )
                  : wireCode === 'adapter-guarantee-violation'
                    ? new AdapterGuaranteeViolationError(
                        error.message,
                        this.errorDiagnostics({
                          suggestion:
                            'use the exact certified framework build or repair its authoritative instrumentation',
                        }),
                      )
                    : wireCode === 'capability-provider-violation'
                      ? new CapabilityProviderViolationError(
                          error.message,
                          this.errorDiagnostics({
                            suggestion:
                              'publish provider evidence for the exact committed session revision',
                          }),
                        )
                      : error;
              this.#diagnostic('protocol-violation', error.message, {
                wireCode,
              });
              this.#settle();
            },
          },
        }),
      (channel) => channel.close(),
    );
    this.#assertLaunchTime(deadline, 'creating the semantic endpoint');

    this.#vt.onRevision((revision) => {
      this.#observationSequence += 1;
      this.#emitter.emit('screen-revision', { revision, timeMs: this.#now() });
      this.#notifyChange();
    });
    this.#vt.onMarker((marker) => {
      const verified = verifyMarkerPayload(marker.payload, this.#token, this.sessionId);
      if (verified === null) {
        this.#diagnostic(
          'marker-unverified',
          'ignoring a render marker whose MAC did not verify: ordinary output cannot forge one',
        );
        return;
      }
      this.#pairing.offerMarker(verified.revision, marker.screenRevision);
    });
    assertLaunchPathsExist(this.#options.command, this.#options.cwd);
    const launchCommand =
      this.#options.shellIntegration === 'termwright-powershell'
        ? integratedPowerShellCommand(this.#options.command)
        : this.#options.command;

    const env = buildChildEnv(this.#options.envMode ?? 'replace', this.#options.env);
    env[ENV_ENDPOINT] = this.#channel.endpoint;
    env[ENV_TOKEN] = this.#token;

    // Own the tailer before the process so ResourceScope's reverse teardown
    // terminates/drains the child first and only then performs the final log
    // EOF pass. Registering it after spawn loses records written during exit.
    const sources = this.#options.logs ?? [];
    if (sources.length > 0) {
      this.#logs = await this.#resources.acquire(
        'application log tailer',
        async () => {
          const logs = new LogTailer(sources, {
            onLine: (source, line) => this.#publishLogLine(source, line),
            onDiagnostic: (code, detail, count) => this.#diagnostic(code, detail, { count }),
          });
          await logs.start();
          return logs;
        },
        (logs) => logs.stop(),
      );
      this.#assertLaunchTime(deadline, 'starting application log capture');
    }

    this.#assertLaunchTime(deadline, 'spawning the pseudo-terminal');
    this.#pty = await this.#resources.acquire(
      'pseudo-terminal',
      () =>
        this.#backend.spawn({
          command: launchCommand,
          ...(this.#options.cwd !== undefined ? { cwd: this.#options.cwd } : {}),
          env,
          // One source of truth: the pty is told the same terminal name the child
          // reads out of TERM.
          term: EMULATED_TERM,
          columns: this.#vt.columns,
          rows: this.#vt.rows,
        }),
      (pty) => this.#disposePty(pty),
    );
    this.#assertLaunchTime(deadline, 'spawning the pseudo-terminal');
    this.#processSupervisor = new ProcessSupervisor(this.#pty, {
      beforeInputClose: () => this.#closeTerminalResponseBridge(),
    });

    // xterm may schedule a protocol reply after parsing returns. The bridge is
    // admitted only while the child can consume PTY input; teardown closes it
    // at the causal process-tree/dispose boundary, not at close() request time
    // while a gracefully exiting child may still need terminal replies.
    this.#terminalResponseAdmissionOpen = true;
    this.#detachTerminalResponse = this.#vt.onResponse((response) => {
      if (!this.#terminalResponseAdmissionOpen) {
        if (!this.#lateTerminalResponseLogged) {
          this.#lateTerminalResponseLogged = true;
          this.#diagnostic(
            'terminal-response-after-input-close',
            'discarded a delayed emulator reply after the application process tree could no longer consume PTY input',
          );
        }
        return;
      }
      // A terminal response is generated by the emulator, not a keyboard or
      // mouse action. Send it through PTY stdin but deliberately do not emit
      // the public `input` event or create an ActionReceipt. The native
      // Windows backend owns the private host-control RPC versus application
      // Win32 Input Mode distinction.
      try {
        const data = Buffer.from(response.data, 'utf8');
        const write = this.#pty!.writeTerminalResponse;
        const route =
          write === undefined
            ? (this.#pty!.write(data), 'application-direct')
            : write.call(this.#pty, data);
        if (route === 'host-control') {
          this.#diagnostic(
            'host-terminal-response',
            `answered pseudoconsole host query (${response.kind}, ${data.byteLength} bytes)`,
          );
          return;
        }
      } catch (error) {
        this.#recordPtyFailure(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.#diagnostic(
        'terminal-response',
        `answered terminal query (${response.kind}, ${Buffer.byteLength(response.data, 'utf8')} bytes)`,
      );
    });

    this.#pty.onData((data) => {
      this.#lastOutputAt = performance.now();
      this.#shellTracker.feed(data);
      this.#emitter.emit('output', { data, timeMs: this.#now() });
      void this.#vt.write(data).finally(() => {
        // Parsing can settle without changing a visible cell (for example a
        // semantic marker or an idempotent control sequence). Action retries
        // still need to wake when that evidence boundary closes.
        this.#notifyChange();
      });
    });
    this.#pty.onExit((status) => {
      // Cache the backend's one-shot evidence before the asynchronous VT drain.
      // close() may begin in that interval and must not subscribe too late.
      this.#processSupervisor?.observeExit(status);
      this.#lifecycle.observeBackendExit(status);
      this.#exitProcessing ??= this.#finishExit(status);
    });
    const detachWriteError = this.#pty.onWriteError?.((error) => {
      this.#recordPtyFailure(error);
    });
    if (detachWriteError !== undefined) {
      this.#resources.defer('PTY asynchronous write observer', detachWriteError);
    }

    // Own exit evidence before waiting for ConPTY attachment. A failed attach
    // rolls the resource scope back, and that rollback still needs the same
    // lifecycle observer to settle `exit`; registering it after the wait made
    // a never-attaching backend impossible to dispose.
    if (this.#pty.attach !== undefined) {
      await this.#attachPty(this.#pty, deadline);
      this.#assertLaunchTime(deadline, 'attaching the pseudo-terminal');
    }

    this.#negotiationTimer = setTimeout(() => {
      this.#negotiationTimer = null;
      this.#channel?.closeAdmission();
    }, negotiationMs);
    this.#negotiationTimer.unref?.();

    if (this.#options.shellIntegration === 'termwright-posix') {
      await this.waitForQuiet({
        quietMs: READY_QUIET_MS,
        timeout: deadline.remaining(),
      });
      this.#assertLaunchTime(deadline, 'waiting for shell startup output');
      await this.sendInput(encodeText(posixShellBootstrap()), 'raw');
      this.#assertLaunchTime(deadline, 'installing shell integration');
      await this.#waitForShellPrompt({ timeout: deadline.remaining() });
    } else if (this.#options.shellIntegration === 'termwright-powershell') {
      // The startup command is the producer of this marker. Waiting for that
      // exact fact replaces the old quiet-window -> stdin race entirely.
      await this.#waitForShellPrompt({ timeout: deadline.remaining() });
    }
  }

  #recordPtyFailure(error: Error): void {
    // A fatal backend write failure is itself a causal input-close boundary.
    // Keep the listener until owned teardown so later xterm tasks are counted,
    // but never attempt another write through an already-poisoned transport.
    this.#terminalResponseAdmissionOpen = false;
    this.#ptyFailure ??= new PtyBackendError(
      `PTY backend ${this.#backend.name} reported a fatal I/O failure: ${error.message}`,
      this.errorDiagnostics({
        suggestion:
          'treat this as infrastructure failure; terminal input and output can no longer be certified',
      }),
      { cause: error },
    );
    this.#diagnostic('endpoint-error', this.#ptyFailure.message);
    this.#notifyChange();
  }

  #assertLaunchTime(deadline: Deadline, phase: string): void {
    if (!deadline.expired()) return;
    throw new TimeoutError(
      `terminal launch exhausted its total ready budget while ${phase}`,
      this.errorDiagnostics(),
    );
  }

  async #attachPty(pty: PtyProcess, deadline: Deadline): Promise<void> {
    this.#assertLaunchTime(deadline, 'attaching the pseudo-terminal');
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(
        new TimeoutError(
          'terminal launch exhausted its total ready budget while attaching the pseudo-terminal',
          this.errorDiagnostics(),
        ),
      );
    }, deadline.remaining());
    timeout.unref?.();
    try {
      await pty.attach?.(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  async awaitLaunchNegotiation(deadline: Deadline): Promise<void> {
    for (;;) {
      if (this.#settled) return;
      this.#assertLaunchTime(deadline, 'waiting for semantic negotiation');
      await this.waitForChange(deadline.at);
    }
  }

  // -------------------------------------------------------------------------
  // Observation

  get terminalProfile(): TerminalProfileId {
    return this.#vt.profile.id as TerminalProfileId;
  }

  contract(): EffectiveSessionContract | null {
    return this.#contract;
  }

  checkpoint(): ObservationStamp {
    this.assertOpen();
    const paired = this.#pairing.published;
    const contractId = this.#contract?.contractId ?? `${this.sessionId}:0`;
    const epoch = this.#contract?.epoch ?? 0;
    return Object.freeze({
      sessionId: this.sessionId,
      contractId,
      epoch,
      sequence: this.#observationSequence,
      screenRevision: this.screenRevision(),
      semanticRevision: paired?.snapshot.revision ?? null,
      pairedScreenRevision: paired?.screenRevision ?? null,
    });
  }

  async waitForCheckpointChange(
    options: { readonly after: ObservationStamp } & WaitOptions,
  ): Promise<ObservationStamp> {
    this.#lifecycle.throwIfFailed();
    const { after } = options;
    const contract = this.#contract;
    if (
      after.sessionId !== this.sessionId ||
      (contract !== null &&
        (after.contractId !== contract.contractId || after.epoch !== contract.epoch))
    ) {
      throw new StaleSnapshotError(
        'checkpoint belongs to a different session contract',
        this.errorDiagnostics(),
      );
    }
    const deadline = Deadline.after(
      this.operationTimeout(options.timeout ?? this.timeouts.action, 'waitForCheckpointChange'),
    );
    for (;;) {
      this.#lifecycle.throwIfFailed();
      const arm = this.armChange(deadline.at);
      const current = this.checkpoint();
      if (current.sequence > after.sequence) {
        arm.cancel();
        return current;
      }
      if (deadline.expired()) {
        arm.cancel();
        throw new TimeoutError(
          `the session did not advance beyond checkpoint ${after.sequence}`,
          this.errorDiagnostics(),
        );
      }
      await arm.wait();
    }
  }

  async waitForCommittedObservation(opts: WaitOptions = {}): Promise<ObservationStamp> {
    const deadline = Deadline.after(
      this.operationTimeout(opts.timeout ?? this.timeouts.action, 'waitForCommittedObservation'),
    );
    await this.settled({ timeout: deadline.remaining() });
    for (;;) {
      const arm = this.armChange(deadline.at);
      this.#assertAlive('waitForCommittedObservation');
      const violation = this.semanticViolation();
      if (violation !== null) {
        arm.cancel();
        throw violation;
      }
      if (this.actionObservationState() === 'settled') {
        arm.cancel();
        return this.checkpoint();
      }
      if (deadline.expired()) {
        arm.cancel();
        throw new TimeoutError(
          'the session did not commit its pending parser and semantic observation',
          this.errorDiagnostics(),
        );
      }
      await arm.wait();
    }
  }

  screen(): ScreenSnapshot {
    this.assertOpen();
    return captureScreen(this.#vt);
  }

  semanticTree(): SemanticSnapshot | null {
    return this.#index?.snapshot ?? null;
  }

  cell(pos: { row: number; column: number }): CellSnapshot {
    this.assertOpen();
    return captureCell(this.#vt, pos.row, pos.column);
  }

  title(): string {
    return this.#vt.title;
  }

  #terminalState(): import('./api.js').TerminalStateSnapshot {
    this.assertOpen();
    const integration = this.#vt.shellIntegration();
    return Object.freeze({
      screenRevision: this.#vt.revision,
      dimensions: Object.freeze({
        columns: this.#vt.terminal.cols,
        rows: this.#vt.terminal.rows,
      }),
      buffer: this.#vt.activeBuffer(),
      title: this.#vt.title,
      cursor: this.#vt.cursor(),
      bellCount: integration.bellCount,
      modes: this.modes(),
    });
  }

  #shellStatus(): import('./api.js').ShellStatus {
    this.assertOpen();
    const integration = this.#vt.shellIntegration();
    return Object.freeze({
      supported: integration.supported,
      ready: integration.lastMark === 'B',
      lastMark: integration.lastMark as 'A' | 'B' | 'C' | 'D' | null,
      lastExitCode: integration.lastExitCode,
      cwd: normalizeShellCwd(integration.cwd),
      title: this.#vt.title,
      cursor: this.#vt.cursor(),
      bellCount: integration.bellCount,
    });
  }

  async #waitForShellPrompt(opts?: WaitOptions): Promise<void> {
    this.assertOpen();
    const timeout = this.operationTimeout(
      opts?.timeout ?? this.timeouts.ready,
      'shell.waitForPrompt',
    );
    const deadline = Deadline.after(timeout);
    for (;;) {
      this.#assertAlive('shell.waitForPrompt');
      const integration = this.#vt.shellIntegration();
      if (integration.supported && integration.lastMark === 'B') return;
      if (deadline.expired()) {
        if (!integration.supported) {
          throw new CapabilityUnavailableError(
            'shell commands require OSC 133 prompt and command markers; this program did not publish them',
            this.errorDiagnostics({
              suggestion:
                'enable shell integration, or drive the program with press(), type() and terminal assertions',
            }),
          );
        }
        throw new TimeoutError(
          `the shell did not report a prompt within ${timeout} ms (last OSC 133 mark ${String(integration.lastMark)})`,
          this.errorDiagnostics(),
        );
      }
      await this.waitForChange(deadline.cap(READY_QUIET_MS));
    }
  }

  async #runShellCommand(
    command: string,
    opts?: import('./api.js').ShellRunOptions,
  ): Promise<ShellCommandResult> {
    if (command.length === 0 || /[\r\n\0]/u.test(command)) {
      throw new TypeError(
        'shell.run() requires one non-empty command without newline or NUL characters',
      );
    }
    const timeout = this.operationTimeout(opts?.timeout ?? 30_000, 'shell.run');
    const deadline = Deadline.after(timeout);
    await this.#waitForShellPrompt({ timeout: deadline.remaining() });
    if (deadline.expired()) {
      throw new TimeoutError(
        'shell.run exhausted its total budget before command submission',
        this.errorDiagnostics(),
      );
    }
    const tracked = this.#shellTracker.arm(command, deadline.remaining(), opts?.maxOutputBytes);
    const actionId = this.beginAction('shell.run');
    const before = this.checkpoint();
    const submitted =
      this.#options.shellIntegration === 'termwright-posix'
        ? wrapPosixShellCommand(command)
        : this.#options.shellIntegration === 'termwright-powershell'
          ? wrapPowerShellCommand(command)
          : command;
    const intent: ActionIntent = Object.freeze({ kind: 'shell-command' });
    const operations: readonly ExecutableDeviceOperation[] = Object.freeze([
      { device: 'keyboard', kind: 'type', value: submitted },
      { device: 'keyboard', kind: 'press', value: 'Enter' },
    ]);
    const plan: ExecutableActionPlan = Object.freeze({
      actionId,
      contractId: before.contractId,
      intent,
      checkpoint: before,
      requirements: Object.freeze([]),
      strategy: 'shell-keyboard-submit',
      operations,
    });
    try {
      const executed = await this.executeDeviceOperations(plan.operations, before, deadline.at);
      const result = await tracked;
      if (deadline.expired()) {
        throw new TimeoutError(
          'shell.run exhausted its total budget while awaiting command completion',
          this.errorDiagnostics(),
        );
      }
      await this.#vt.drain();
      await this.#waitForShellPrompt({ timeout: deadline.remaining() });
      const integration = this.#vt.shellIntegration();
      const receipt: ActionReceipt = Object.freeze({
        intent,
        plan: recordActionPlan(plan, this.artifactSecurity.mode),
        before,
        after: this.checkpoint(),
        executed: Object.freeze(
          executed.map((operation) => recordDeviceOperation(operation, this.artifactSecurity.mode)),
        ),
        outcome: 'completed',
      });
      this.endAction(actionId, 'shell.run', true, { receipt });
      return Object.freeze({
        command: result.command,
        output: result.output,
        exitCode: result.exitCode,
        cwd: normalizeShellCwd(integration.cwd),
        title: this.#vt.title,
        receipt,
      });
    } catch (error) {
      this.endAction(actionId, 'shell.run', false, {
        error: actionErrorCode(error),
      });
      this.#shellTracker.close(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Locators

  getByRole(role: SemanticRole, opts?: RoleLocatorOptions): SemanticLocator {
    const name = opts?.name === undefined ? undefined : textMatcher(opts.name, opts.exact ?? false);
    // Exact by default for a framework type: it is an identifier the framework
    // chose, not prose a user typed, so a substring match would be a guess.
    const frameworkType =
      opts?.frameworkType === undefined ? undefined : textMatcher(opts.frameworkType, true);
    return new LocatorImpl(
      this,
      roleQuery(role, name, opts?.state ?? {}, frameworkType),
    ) as unknown as SemanticLocator;
  }

  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): SemanticLocator {
    return new LocatorImpl(
      this,
      labelQuery(textMatcher(text, opts?.exact ?? false)),
    ) as unknown as SemanticLocator;
  }

  getByText(text: string | RegExp, opts?: TextLocatorOptions): SemanticLocator {
    const matcher = textMatcher(text, opts?.exact ?? false);
    return new LocatorImpl(this, textQuery(matcher)) as unknown as SemanticLocator;
  }

  getByScreenText(text: string | RegExp, opts?: ScreenTextLocatorOptions): ScreenLocator {
    const matcher = textMatcher(text, opts?.exact ?? false);
    const style: StylePredicates | undefined =
      opts?.fg !== undefined || opts?.bg !== undefined || opts?.attributes !== undefined
        ? {
            ...(opts.fg !== undefined ? { fg: opts.fg } : {}),
            ...(opts.bg !== undefined ? { bg: opts.bg } : {}),
            ...(opts.attributes !== undefined ? { attributes: opts.attributes } : {}),
          }
        : undefined;
    return new LocatorImpl(
      this,
      gridQuery(matcher, opts?.occurrence, style),
    ) as unknown as ScreenLocator;
  }

  getByTestId(testId: string): SemanticLocator {
    return new LocatorImpl(this, parseSelector(`#${testId}`)) as unknown as SemanticLocator;
  }

  locator(selector: string): SemanticLocator {
    return new LocatorImpl(this, parseSelector(selector)) as unknown as SemanticLocator;
  }

  /**
   * The best identity the attached producer can offer.
   *
   * A hand-written adapter that never sent a probe block is taken at the
   * protocol's word: node ids are stable within a semantic session. A probe
   * says what it can actually deliver, and Ratatui can deliver nothing better
   * than an index into one frame.
   */
  identityKind(): ResolvedTarget['identity'] {
    return this.#attachment?.probe?.identityKind ?? 'stable';
  }

  semanticBoundsAreAbsolute(): boolean {
    return this.#attachment?.capabilities.includes('intended-geometry') === true;
  }

  locatorForRef(ref: import('./api.js').SemanticLocatorRef): SemanticLocator;
  locatorForRef(ref: import('./api.js').ScreenLocatorRef): ScreenLocator;
  locatorForRef(ref: LocatorRef): SemanticLocator | ScreenLocator;
  locatorForRef(ref: LocatorRef): SemanticLocator | ScreenLocator {
    if (this.identityKind() === 'frame-local') {
      throw new CapabilityUnavailableError(
        `this session's producer has frame-local identity, so ref ${JSON.stringify(ref)} cannot be re-resolved`,
        this.errorDiagnostics({
          suggestion:
            'address the node by role, name or testId; a frame-local id means something different in every frame',
        }),
      );
    }
    const parsed = parseRef(ref);
    if (parsed === null) {
      throw new TypeError(
        `ref ${JSON.stringify(ref)} is not a termwright ref; refs look like ` +
          "'semantic:n8@42' (semantic node) or 'screen:1,2,9,1@7' (grid match)",
      );
    }
    // A ref identifies one node, so it is resolved by identity rather than by
    // re-querying role+name — two buttons with the same name stay distinct.
    return new LocatorImpl(this, refQuery(parsed)) as unknown as SemanticLocator | ScreenLocator;
  }

  // -------------------------------------------------------------------------
  // Input

  async press(keys: string): Promise<void> {
    await this.#rawDeviceAction('press', { kind: 'press' }, [
      { device: 'keyboard', kind: 'press', value: keys },
    ]);
  }

  async type(text: ExecutableValue): Promise<void> {
    await this.#rawDeviceAction('type', { kind: 'type' }, [
      { device: 'keyboard', kind: 'type', value: text },
    ]);
  }

  async paste(text: ExecutableValue): Promise<void> {
    await this.#rawDeviceAction('paste', { kind: 'paste' }, [
      { device: 'keyboard', kind: 'paste', value: text },
    ]);
  }

  async write(bytes: Uint8Array | string): Promise<void> {
    await this.#act('write', async () => {
      const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
      await this.sendInput(data, 'raw');
    });
  }

  async #keyboardPress(keys: string): Promise<void> {
    await this.#rawDeviceAction('keyboard.press', { kind: 'press' }, [
      { device: 'keyboard', kind: 'press', value: keys },
    ]);
  }

  async #keyboardType(text: ExecutableValue): Promise<void> {
    await this.#rawDeviceAction('keyboard.type', { kind: 'type' }, [
      { device: 'keyboard', kind: 'type', value: text },
    ]);
  }

  async #keyboardPaste(text: ExecutableValue): Promise<void> {
    await this.#rawDeviceAction('keyboard.paste', { kind: 'paste' }, [
      { device: 'keyboard', kind: 'paste', value: text },
    ]);
  }

  async #windowFocus(focused: boolean): Promise<void> {
    await this.#act(focused ? 'window.focus' : 'window.blur', async () => {
      await this.#awaitLiveInputModeEvidence();
      this.#assertInputModeEvidenceLive('focus-input');
      await this.#sendFocus(focused);
    });
  }

  /**
   * Waits for provider mode evidence to describe the present again.
   *
   * Every input can make the application change its input modes, so the last
   * provider frame stops describing the terminal the moment one is sent. The
   * locator path is barriered on the same condition; the raw device API had no
   * barrier, which let a second `mouse.*` or `window.*` call encode for modes
   * the application may have just turned off. Waiting is what the evidence
   * allows: the application publishes a causally newer frame, and only then is
   * there something fresh to read. Sessions without providers never set the
   * flag and never wait here.
   */
  async #awaitLiveInputModeEvidence(): Promise<void> {
    if (!this.#inputEvidence.waitingForProviderEvidence) return;
    await this.waitForCommittedObservation();
  }

  #point(point: MousePoint): MousePoint {
    if (
      !Number.isSafeInteger(point.row) ||
      point.row < 0 ||
      !Number.isSafeInteger(point.column) ||
      point.column < 0
    ) {
      throw new TypeError(
        `mouse coordinates must be non-negative safe integers, received (${point.row}, ${point.column})`,
      );
    }
    return Object.freeze({ row: point.row, column: point.column });
  }

  #mousePoint(point: MousePoint & { readonly modifiers?: readonly string[] }): MousePoint & {
    readonly modifiers: readonly ('shift' | 'alt' | 'control')[];
  } {
    return Object.freeze({
      ...this.#point(point),
      modifiers: normalizeMouseModifiers(point.modifiers),
    });
  }

  async #mouseEvents(api: string, events: readonly MouseEvent[]): Promise<void> {
    await this.#awaitLiveInputModeEvidence();
    this.#assertInputModeEvidenceLive('pointer-input');
    const operations = events.map((event): ExecutableDeviceOperation =>
      event.kind === 'press'
        ? {
            device: 'mouse',
            kind: 'down',
            row: event.row,
            column: event.column,
            button: event.button ?? 'left',
            modifiers: normalizeMouseModifiers(event.modifiers),
          }
        : event.kind === 'release'
          ? {
              device: 'mouse',
              kind: 'up',
              row: event.row,
              column: event.column,
              button: event.button ?? 'left',
              modifiers: normalizeMouseModifiers(event.modifiers),
            }
          : event.kind === 'move'
            ? {
                device: 'mouse',
                kind: 'move',
                row: event.row,
                column: event.column,
                modifiers: normalizeMouseModifiers(event.modifiers),
                ...(event.dragging === true ? { button: event.button ?? 'left' } : {}),
              }
            : {
                device: 'mouse',
                kind: 'wheel',
                row: event.row,
                column: event.column,
                modifiers: normalizeMouseModifiers(event.modifiers),
                ...(event.wheelAxis === 'horizontal'
                  ? { deltaX: Math.sign(event.wheelDelta ?? 0) }
                  : { deltaY: Math.sign(event.wheelDelta ?? 0) }),
              },
    );
    const intentKind =
      api === 'mouse.doubleClick'
        ? 'double-click'
        : api === 'mouse.move'
          ? 'hover'
          : api === 'mouse.drag'
            ? 'drag'
            : api === 'mouse.wheel'
              ? 'wheel'
              : 'click';
    await this.#rawDeviceAction(api, { kind: intentKind }, operations);
  }

  async #mouseClick(
    point: MousePoint & {
      readonly modifiers?: readonly string[];
      readonly button?: 'left' | 'middle' | 'right';
      readonly clickCount?: 1 | 2;
    },
  ): Promise<void> {
    const at = this.#mousePoint(point);
    const button = point.button ?? 'left';
    const count = point.clickCount ?? 1;
    const modes = this.modes();
    const events: MouseEvent[] = [];
    for (let index = 0; index < count; index += 1) {
      events.push({ kind: 'press', button, ...at });
      if (modes.mouseTracking !== 'x10') events.push({ kind: 'release', button, ...at });
    }
    await this.#mouseEvents(count === 2 ? 'mouse.doubleClick' : 'mouse.click', events);
  }

  async #mouseWheel(
    options: MousePoint & {
      readonly modifiers?: readonly string[];
      readonly deltaY?: number;
      readonly deltaX?: number;
    },
  ): Promise<void> {
    const at = this.#mousePoint(options);
    const vertical = options.deltaY ?? 0;
    const horizontal = options.deltaX ?? 0;
    if (!Number.isSafeInteger(vertical) || !Number.isSafeInteger(horizontal)) {
      throw new TypeError(
        `mouse.wheel() deltas must be safe integers, received (${String(horizontal)}, ${String(vertical)})`,
      );
    }
    if (vertical === 0 && horizontal === 0)
      throw new TypeError('mouse.wheel() requires a non-zero deltaY or deltaX');
    if (Math.abs(vertical) > 100 || Math.abs(horizontal) > 100) {
      throw new RangeError('mouse.wheel() accepts at most 100 steps per axis');
    }
    const events: MouseEvent[] = [
      ...Array.from({ length: Math.abs(vertical) }, (): MouseEvent => ({
        kind: 'wheel',
        wheelAxis: 'vertical',
        wheelDelta: vertical,
        ...at,
      })),
      ...Array.from({ length: Math.abs(horizontal) }, (): MouseEvent => ({
        kind: 'wheel',
        wheelAxis: 'horizontal',
        wheelDelta: horizontal,
        ...at,
      })),
    ];
    await this.#mouseEvents('mouse.wheel', events);
  }

  async #mouseDrag(options: {
    readonly modifiers?: readonly string[];
    readonly from: MousePoint;
    readonly to: MousePoint;
    readonly steps?: number;
    readonly path?: readonly MousePoint[];
  }): Promise<void> {
    const from = this.#point(options.from);
    const to = this.#point(options.to);
    const steps =
      options.steps ?? Math.max(Math.abs(to.row - from.row), Math.abs(to.column - from.column), 1);
    if (!Number.isSafeInteger(steps) || steps < 1 || steps > 1_000) {
      throw new RangeError(
        `mouse.drag() steps must be an integer from 1 to 1000, received ${String(steps)}`,
      );
    }
    const path =
      options.path === undefined
        ? Array.from({ length: steps }, (_, index) => {
            const ratio = (index + 1) / steps;
            return this.#point({
              row: Math.round(from.row + (to.row - from.row) * ratio),
              column: Math.round(from.column + (to.column - from.column) * ratio),
            });
          })
        : [...options.path.map((point) => this.#point(point)), to];
    const unique = path.filter(
      (point, index) =>
        index === 0 ||
        point.row !== path[index - 1]?.row ||
        point.column !== path[index - 1]?.column,
    );
    const modifiers = normalizeMouseModifiers(options.modifiers);
    await this.#mouseEvents('mouse.drag', [
      { kind: 'press', button: 'left', modifiers, ...from },
      ...unique.map((point): MouseEvent => ({
        kind: 'move',
        button: 'left',
        dragging: true,
        modifiers,
        ...point,
      })),
      { kind: 'release', button: 'left', modifiers, ...to },
    ]);
  }

  async signal(sig: 'INT' | 'TERM' | 'KILL' | 'HUP'): Promise<void> {
    await this.#act('signal', async () => {
      this.assertOpen();
      this.#lifecycle.throwIfFailed();
      this.#pty?.signal(sig);
      // Set only after the backend accepted the operation. An unsupported
      // Windows signal must not suppress a later genuine crash report.
      this.#lifecycle.requestTeardown();
      await Promise.resolve();
    });
  }

  async resize(size: { columns: number; rows: number }): Promise<import('./api.js').ResizeReceipt> {
    return this.#act('resize', async () => {
      this.assertOpen();
      this.#lifecycle.throwIfFailed();
      const deadline = Deadline.after(this.operationTimeout(this.timeouts.action, 'resize'));
      if (size.columns <= 0 || size.rows <= 0) {
        throw new TypeError(
          `resize() needs positive dimensions, received ${size.columns}x${size.rows}`,
        );
      }
      const before = this.checkpoint();
      // Catch the parser up before establishing the barrier. Bytes the child
      // sent before the resize can still be queued, and committing them raises
      // the revision without the child having reacted at all — which the wait
      // below would then accept as its answer. That is how a resize could
      // report a repaint that had not happened yet. Draining first cannot
      // swallow the reaction, because the reaction can only follow the resize.
      await this.#vt.drain();
      this.#pty?.resize(size.columns, size.rows);
      this.#vt.resize(size.columns, size.rows);
      const localResizeRevision = this.#vt.revision;
      this.#emitter.emit('resize', {
        columns: size.columns,
        rows: size.rows,
        timeMs: this.#now(),
      });
      const hasSemanticRenderPairing = this.semanticAttached();
      if (hasSemanticRenderPairing) {
        // A certified framework frame is the authoritative child consequence.
        // It may pair to the screen revision created by the local resize when
        // the child only changes semantic geometry, so requiring a strictly
        // later VT revision would reject a real causal frame.
        for (;;) {
          const checkpoint = this.checkpoint();
          if (
            checkpoint.semanticRevision !== null &&
            checkpoint.semanticRevision > (before.semanticRevision ?? -1) &&
            checkpoint.pairedScreenRevision !== null &&
            checkpoint.pairedScreenRevision >= localResizeRevision
          )
            break;
          if (deadline.expired()) {
            throw new TimeoutError(
              'the child repainted after resize but did not publish its paired semantic frame',
              this.errorDiagnostics(),
            );
          }
          await this.waitForChange(deadline.at);
        }
      }
      const after = this.checkpoint();
      return Object.freeze({
        requested: Object.freeze({ columns: size.columns, rows: size.rows }),
        before,
        after,
        pairedRender: hasSemanticRenderPairing
          ? Object.freeze({
              status: 'known',
              value: after.screenRevision,
              evidence: Object.freeze({
                source: 'terminal',
                method: 'native',
                strength: 'authoritative',
                providerId: 'termwright-vt',
              }),
            } as const)
          : Object.freeze({
              status: 'unsupported',
              capability: 'resize-render-pairing',
              reason: 'not-negotiated',
            } as const),
      });
    });
  }

  // -------------------------------------------------------------------------
  // Waits

  async waitForText(text: string | RegExp, opts?: WaitOptions): Promise<void> {
    const matcher = textMatcher(text, false);
    const deadline = Deadline.after(
      this.operationTimeout(opts?.timeout ?? this.timeouts.text, 'waitForText'),
    );
    const matches = (): boolean => {
      const screenText = captureText(this.#vt);
      if (matcher.kind === 'regex') {
        return new RegExp(matcher.source.source, matcher.source.flags.replace('g', '')).test(
          screenText,
        );
      }
      return screenText.includes(matcher.text);
    };
    for (;;) {
      this.#lifecycle.throwIfFailed();
      if (matches()) return;
      if (deadline.expired()) {
        throw new TimeoutError(
          `text ${text instanceof RegExp ? String(text) : JSON.stringify(text)} never appeared on screen`,
          this.errorDiagnostics({
            suggestion: 'check the screen excerpt below for the text the program actually printed',
          }),
        );
      }
      this.#assertAlive('waitForText');
      await this.waitForChange(deadline.at);
    }
  }

  async waitForRender(opts: { after: number } & WaitOptions): Promise<void> {
    this.#lifecycle.throwIfFailed();
    const deadline = Deadline.after(
      this.operationTimeout(opts.timeout ?? this.timeouts.action, 'waitForRender'),
    );
    while (this.#vt.revision <= opts.after) {
      this.#lifecycle.throwIfFailed();
      if (deadline.expired()) {
        throw new TimeoutError(
          `no render after revision ${opts.after} (still at ${this.#vt.revision})`,
          this.errorDiagnostics(),
        );
      }
      this.#assertAlive('waitForRender');
      await this.waitForChange(deadline.at);
    }
  }

  async waitForQuiet(opts?: { quietMs?: number } & WaitOptions): Promise<void> {
    this.#lifecycle.throwIfFailed();
    const quiet = opts?.quietMs ?? IDLE_QUIET_MS;
    if (!Number.isFinite(quiet) || quiet < 0)
      throw new RangeError('quietMs must be a finite non-negative number');
    const deadline = Deadline.after(
      this.operationTimeout(opts?.timeout ?? this.timeouts.idle, 'waitForQuiet'),
    );
    for (;;) {
      this.#lifecycle.throwIfFailed();
      const before = this.#vt.revision;
      const semanticBefore = this.#pairing.revision;
      await this.waitForChange(deadline.cap(quiet));
      this.#lifecycle.throwIfFailed();
      const unchanged = this.#vt.revision === before && this.#pairing.revision === semanticBefore;
      if (unchanged && !this.#pairing.hasBlockingRender) return;
      if (deadline.expired()) {
        throw new TimeoutError(
          `the screen and semantic evidence never stayed quiet for ${quiet} ms`,
          this.errorDiagnostics({
            suggestion:
              'raise the timeout, or assert on a concrete locator instead of waiting for silence',
          }),
        );
      }
    }
  }

  async waitForShellPrompt(opts?: WaitOptions): Promise<void> {
    await this.#waitForShellPrompt(opts);
    this.#diagnostic('ready-shell-integration', 'the shell published an OSC 133 prompt marker');
  }

  async waitForExit(opts?: WaitOptions): Promise<ExitStatus> {
    if (this.#lifecycle.status !== null) return this.#lifecycle.status;
    const deadline = Deadline.after(
      this.operationTimeout(opts?.timeout ?? this.timeouts.exit, 'waitForExit'),
    );
    for (;;) {
      if (this.#lifecycle.status !== null) return this.#lifecycle.status;
      this.#lifecycle.throwIfFailed();
      if (deadline.expired()) {
        throw new TimeoutError(
          `the program was still running after ${opts?.timeout ?? this.timeouts.exit} ms`,
          this.errorDiagnostics({
            suggestion: 'send signal("INT") or signal("TERM") before awaiting exit',
          }),
        );
      }
      await this.waitForChange(deadline.at);
    }
  }

  get exit(): Promise<ExitStatus> {
    return this.#lifecycle.exit;
  }

  async waitForTitle(text: string | RegExp, opts?: WaitOptions): Promise<void> {
    const matcher = textMatcher(text, false);
    const deadline = Deadline.after(
      this.operationTimeout(opts?.timeout ?? this.timeouts.text, 'waitForTitle'),
    );
    for (;;) {
      this.#lifecycle.throwIfFailed();
      const title = this.#vt.title;
      const hit =
        matcher.kind === 'regex'
          ? new RegExp(matcher.source.source, matcher.source.flags.replace('g', '')).test(title)
          : title.includes(matcher.text);
      if (hit) return;
      if (deadline.expired()) {
        throw new TimeoutError(
          `the window title never matched (last title: ${JSON.stringify(title)})`,
          this.errorDiagnostics(),
        );
      }
      this.#assertAlive('waitForTitle');
      await this.waitForChange(deadline.at);
    }
  }

  // -------------------------------------------------------------------------
  // LocatorContext

  negotiationPending(): boolean {
    return !this.#settled;
  }

  negotiationSettled(): Promise<void> {
    if (this.#settled) return Promise.resolve();
    return new Promise<void>((resolve) => this.#settleWaiters.push(resolve));
  }

  /**
   * Waits until the capabilities stop changing.
   *
   * Two things can still be pending after `launchTerminal` resolves: the
   * negotiation window and the first tree of an adapter that did attach. Callers that branch on
   * semantic consumers need all three settled; observing provisional adapter
   * them is exactly the workaround this replaces.
   */
  async settled(opts?: WaitOptions): Promise<EffectiveSessionContract> {
    this.assertOpen();
    this.#lifecycle.throwIfFailed();
    const deadline = Deadline.after(
      this.operationTimeout(opts?.timeout ?? this.timeouts.action, 'settled'),
    );
    await this.negotiationSettled();

    for (;;) {
      this.#lifecycle.throwIfFailed();
      const semanticFailure = this.semanticViolation();
      if (semanticFailure !== null) throw semanticFailure;
      const attached = this.#attachment !== null;
      if (!attached && !this.semanticPossible()) return this.#requireContract();
      if (attached && this.#index !== null) return this.#requireContract();
      if (deadline.expired()) {
        if (!attached) return this.#requireContract();
        // Attached but silent: reporting a semantic session whose tree never
        // arrived would be a lie the caller cannot act on.
        throw new TimeoutError(
          'an adapter attached but published no tree before the deadline',
          this.errorDiagnostics({
            suggestion:
              'the adapter negotiated the semantic channel; check that it publishes a snapshot and a render marker',
          }),
        );
      }
      await this.waitForChange(deadline.at);
    }
  }

  semanticIndex(): SemanticIndex | null {
    return this.#index;
  }

  semanticNode(id: string): SemanticNode | undefined {
    return this.#index?.node(id);
  }

  pointerRegion(id: string):
    | {
        readonly regionBounds: import('@termwright/protocol').Rect;
        readonly spans: import('@termwright/protocol').PhysicalRegion['spans'];
        readonly evidence: EvidenceProvenance;
      }
    | undefined {
    const snapshot = this.#index?.snapshot;
    const contract = this.#contract;
    if (snapshot === undefined || contract === null) return undefined;
    const availability = contract.capabilities['pointer-geometry'];
    if (availability.status !== 'supported') return undefined;
    if (availability.evidence.source === 'application') {
      const frame = snapshot.providerEvidence?.find(
        (entry) =>
          entry.providerId === availability.evidence.providerId && entry.status === 'available',
      );
      if (frame?.status !== 'available') return undefined;
      const region = frame.pointerRegions.find((entry) => entry.recipientId === id);
      return region === undefined
        ? undefined
        : Object.freeze({ ...region, evidence: frame.evidence });
    }
    const node = this.#index?.node(id);
    const grid = snapshot.hitGrid;
    if (
      node?.geometry.intendedRect.status !== 'known' ||
      node.geometry.visibleRect.status !== 'known' ||
      grid.status !== 'known'
    )
      return undefined;
    const visible = node.geometry.visibleRect.value;
    const spans = grid.value.regions
      .filter((entry) => entry.recipientId === id)
      .flatMap((entry) => {
        const row = Math.max(entry.rect.row, visible.row);
        const bottom = Math.min(entry.rect.row + entry.rect.height, visible.row + visible.height);
        const from = Math.max(entry.rect.column, visible.column);
        const to = Math.min(entry.rect.column + entry.rect.width, visible.column + visible.width);
        return from >= to || row >= bottom
          ? []
          : Array.from({ length: bottom - row }, (_, offset) =>
              Object.freeze({ row: row + offset, from, to }),
            );
      });
    return Object.freeze({
      regionBounds: node.geometry.intendedRect.value,
      spans: Object.freeze(spans),
      evidence: availability.evidence,
    });
  }

  screenRegionUnchangedSince(
    revision: number,
    spans: import('@termwright/protocol').PhysicalRegion['spans'],
  ): boolean {
    return this.#vt.regionUnchangedSince(revision, spans);
  }

  screenRows(): readonly { readonly text: string }[] {
    return captureRows(this.#vt);
  }

  screenRegionChangeSince(
    revision: number,
    spans: import('@termwright/protocol').PhysicalRegion['spans'],
  ): string {
    return this.#vt.regionChangeSince(revision, spans);
  }

  hitGrid(): Observation<PointerHitGrid> | undefined {
    return this.#index?.snapshot.hitGrid;
  }

  async executeDeviceOperations(
    operations: readonly ExecutableDeviceOperation[],
    expected: ObservationStamp,
    deadline?: number,
  ): Promise<readonly ExecutableDeviceOperation[]> {
    const deadlineDiagnostics = this.errorDiagnostics({
      suggestion: 'increase the action timeout or wait for the target state explicitly',
    });
    if (deadline !== undefined) assertBeforeActionInput(deadline, deadlineDiagnostics);
    const current = this.checkpoint();
    if (current.contractId !== expected.contractId || current.sequence !== expected.sequence) {
      throw new StaleSnapshotError(
        `action plan at checkpoint ${expected.sequence} became stale before input (current ${current.sequence})`,
        this.errorDiagnostics({
          suggestion:
            'retry the action so Termwright can re-resolve and re-plan without stale coordinates',
        }),
      );
    }
    const modes = this.modes();
    const encoded = operations.map((operation) => {
      if (operation.device === 'keyboard') {
        const bytes =
          operation.kind === 'press'
            ? encodeKeys(executableText(operation.value), modes)
            : operation.kind === 'paste'
              ? encodePaste(executableText(operation.value), modes.bracketedPaste)
              : encodeText(executableText(operation.value));
        return Object.freeze({
          operation,
          bytes,
          inputKind: operation.kind === 'paste' ? ('paste' as const) : ('key' as const),
        });
      }
      const modifierFields =
        operation.modifiers === undefined ? {} : { modifiers: operation.modifiers };
      const event: MouseEvent =
        operation.kind === 'move'
          ? {
              kind: 'move',
              ...(operation.button !== undefined
                ? { button: operation.button, dragging: true }
                : {}),
              ...modifierFields,
              row: operation.row,
              column: operation.column,
            }
          : operation.kind === 'down'
            ? {
                kind: 'press',
                button: operation.button ?? 'left',
                ...modifierFields,
                row: operation.row,
                column: operation.column,
              }
            : operation.kind === 'up'
              ? {
                  kind: 'release',
                  button: operation.button ?? 'left',
                  ...modifierFields,
                  row: operation.row,
                  column: operation.column,
                }
              : {
                  kind: 'wheel',
                  ...modifierFields,
                  row: operation.row,
                  column: operation.column,
                  wheelDelta: operation.deltaY ?? operation.deltaX ?? 0,
                  wheelAxis: operation.deltaX !== undefined ? 'horizontal' : 'vertical',
                };
      return Object.freeze({
        operation,
        bytes: encodeMouse(event, modes),
        inputKind: 'mouse' as const,
      });
    });
    const executed: ExecutableDeviceOperation[] = [];
    let held: {
      button: 'left' | 'middle' | 'right';
      row: number;
      column: number;
    } | null = null;
    try {
      for (const { operation, bytes, inputKind } of encoded) {
        if (executed.length === 0 && deadline !== undefined)
          assertBeforeActionInput(deadline, deadlineDiagnostics);
        await this.sendInput(bytes, inputKind);
        executed.push(operation);
        if (operation.device === 'keyboard') continue;
        if (operation.kind === 'down') {
          held = {
            button: operation.button ?? 'left',
            row: operation.row,
            column: operation.column,
          };
        } else if (operation.kind === 'move' && held !== null) {
          const active = held as {
            button: 'left' | 'middle' | 'right';
            row: number;
            column: number;
          };
          held = {
            button: active.button,
            row: operation.row,
            column: operation.column,
          };
        } else if (operation.kind === 'up') {
          held = null;
        }
      }
    } catch (error) {
      if (held !== null) {
        try {
          await this.sendInput(encodeMouse({ kind: 'release', ...held }, modes), 'mouse');
        } catch {
          // Preserve the original failure. The session may already be closed,
          // in which case no further PTY write can release the button.
        }
      }
      throw error;
    }
    return Object.freeze([...executed]);
  }

  semanticAttached(): boolean {
    return this.#attachment !== null;
  }

  /**
   * True while a semantic tree may still arrive: an adapter is attached or the
   * negotiation window remains open.
   * Semantic locators wait while this holds and only fail once it does not.
   */
  semanticPossible(): boolean {
    if (this.#attachment !== null) return true;
    return !this.#settled;
  }

  semanticViolation(): TermwrightError | null {
    return this.#ptyFailure ?? this.#providerFailure ?? this.#violation;
  }

  semanticRevision(): number {
    return this.#pairing.revision;
  }

  screenRevision(): number {
    return this.#vt.revision;
  }

  rows(): readonly CapturedRow[] {
    return captureRows(this.#vt);
  }

  modes(): TerminalModes {
    const observed = this.#vt.modes();
    const provided = this.#providerInputModes;
    if (provided === null) return observed;
    // Deliberately not gated on provider-evidence staleness. Callers that act
    // on these modes wait for fresh evidence first (see
    // #awaitLiveInputModeEvidence); blanking the fields here would instead
    // make every diagnostic read say "unknown" for as long as the application
    // has not redrawn, which is less true than the last committed frame, not
    // more.
    return Object.freeze({
      ...observed,
      mouseTracking:
        observed.mouseTracking === 'unknown' ? provided.mouseTracking : observed.mouseTracking,
      mouseEncoding:
        observed.mouseEncoding === 'unknown' ? provided.mouseEncoding : observed.mouseEncoding,
      focusReporting:
        observed.focusReporting === 'unknown' ? provided.focusReporting : observed.focusReporting,
    });
  }

  /**
   * Provider-backed mode facts are revision-bound. Retaining their last value
   * is useful for failure diagnostics, but it must never authorize fresh input
   * after the provider/session contract has failed.
   */
  #assertInputModeEvidenceLive(capability: 'pointer-input' | 'focus-input'): void {
    if (this.#providerInputModes !== null && this.#providerFailure !== null) {
      throw this.#providerFailure;
    }
    const contracted = this.#contract?.capabilities[capability];
    if (contracted?.status !== 'unsupported') return;
    // A terminal that hides its modes is not the same as a session that lacks
    // the capability, and only the mode layer can say which sequence is
    // missing. Refusing here would replace "1002 was never enabled, and this
    // terminal will not let me see it" with a bare contract complaint, and it
    // would do so inconsistently: the contract is frozen by negotiation or by
    // the first locator action, so the same mouse.drag() reported different
    // codes depending on what ran before it. Fall through and let the mode
    // layer refuse — the action is still denied, with the reason intact.
    if (contracted.reason === 'terminal-unobservable') return;
    throw new CapabilityUnavailableError(
      `${capability} is outside this frozen session contract`,
      this.errorDiagnostics({
        suggestion: capabilityRemediation(`session.${capability}`).message,
      }),
    );
  }

  actionObservationState():
    'settled' | 'parser-in-flight' | 'semantic-frame-open' | 'pairing-pending' {
    if (this.#vt.hasPendingWrite) return 'parser-in-flight';
    if (this.#pairing.hasOpenFrame) return 'semantic-frame-open';
    // Semantic actions must remain fail-closed while *any* authoritative half
    // is retained, even after its watchdog reports it. The newer half proves
    // that the published tree and screen may no longer describe one state.
    if (this.#pairing.hasPendingRender) return 'pairing-pending';
    if (this.#inputEvidence.waitingForProviderEvidence) return 'pairing-pending';
    return 'settled';
  }

  actionObservationWait(
    actionId: string,
    state: 'parser-in-flight' | 'semantic-frame-open' | 'pairing-pending',
  ): void {
    this.#diagnostic('action-observation-wait', `action ${actionId} is waiting for ${state}`, {
      actionId,
      observationState: state,
    });
  }

  waitForChange(deadline: number): Promise<void> {
    return this.armChange(deadline).wait();
  }

  armChange(deadline: number): { wait(): Promise<void>; cancel(): void } {
    const remaining = Math.max(0, deadline - performance.now());
    let settled = false;
    let resolvePromise: (() => void) | undefined;
    let waiter: ChangeWaiter | undefined;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
      const registered: ChangeWaiter = {
        resolve: () => {
          if (settled) return;
          settled = true;
          clearTimeout(registered.timer);
          this.#changeWaiters.delete(registered);
          resolve();
        },
        timer: setTimeout(() => {
          settled = true;
          this.#changeWaiters.delete(registered);
          resolve();
        }, remaining),
      };
      waiter = registered;
      registered.timer.unref?.();
      this.#changeWaiters.add(registered);
    });
    return {
      wait: () => promise,
      cancel: () => {
        if (settled) return;
        settled = true;
        if (waiter !== undefined) {
          clearTimeout(waiter.timer);
          this.#changeWaiters.delete(waiter);
        }
        resolvePromise?.();
      },
    };
  }

  async sendInput(data: Uint8Array, kind: 'key' | 'mouse' | 'paste' | 'raw'): Promise<void> {
    this.assertOpen();
    this.#lifecycle.throwIfFailed();
    if (this.#lifecycle.status !== null) {
      throw new ProcessExitedError(
        `cannot send input: the program exited with code ${String(this.#lifecycle.status.code)}`,
        this.errorDiagnostics(),
      );
    }
    // Output parsing can synchronously generate an application-owned terminal
    // reply (DSR, DECRQM, colour queries, and similar control-plane traffic).
    // Preserve that causal order before admitting keyboard/mouse input. This
    // matters on ConPTY in particular: its private response envelope must be
    // committed to the console input buffer before later user input can be
    // observed by a ReadConsoleInput application. The caught-up branch keeps
    // the ordinary input hot path synchronous up to the PTY write.
    if (!this.#vt.isCaughtUp) {
      await this.#vt.drain();
      this.assertOpen();
      this.#lifecycle.throwIfFailed();
      const statusAfterDrain = this.#lifecycle.status as ExitStatus | null;
      if (statusAfterDrain !== null) {
        throw new ProcessExitedError(
          `cannot send input: the program exited with code ${String(statusAfterDrain.code)}`,
          this.errorDiagnostics(),
        );
      }
    }
    // Every real PTY input can change application-owned facts. Provider
    // evidence is revision-bound, so no later semantic action may reuse it
    // until the application publishes a causally newer committed frame. This
    // includes raw write(), terminal-window focus reports and direct devices,
    // not only Locator-generated input recipes.
    this.#inputEvidence.noteInput(
      (this.#attachment?.providers.length ?? 0) > 0,
      this.#pairing.revision,
    );
    this.#pty?.write(data, kind);
    const timeMs = this.#now();
    this.#evidence.rememberInput(data, kind, timeMs, this.artifactSecurity.mode);
    this.#emitter.emit('input', { data, timeMs, kind });
    await Promise.resolve();
  }

  /**
   * Resolves once a missing pairing half can honestly be called missing: the
   * emulator has parsed what arrived, and the stream has stopped talking.
   *
   * Both halves of that are needed because the delay has two possible owners.
   * A flood measured 0.7 s of parse backlog with a transport that added
   * nothing; a pty slower than the semantic socket measured 1.7 s of transport
   * backlog with nothing queued for the parser. Either one alone would expire
   * a marker the driver was about to receive.
   *
   * One wait is shared by every pending half: the condition is a property of
   * the session, not of a revision, so thirty-two halves must not mean
   * thirty-two timers.
   */
  #evidenceSettled(): Promise<void> {
    this.#settling ??= this.#awaitEvidence().finally(() => {
      this.#settling = null;
    });
    return this.#settling;
  }

  async #awaitEvidence(): Promise<void> {
    await this.#vt.drain();
    await waitForQuiet({
      lastOutputAt: () => this.#lastOutputAt,
      quietMs: PAIRING_TIMEOUT_MS,
      now: () => performance.now(),
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          timer.unref?.();
        }),
      cancelled: () => this.#closed,
    });
    // Output that arrived during the quiet wait still has to be parsed.
    await this.#vt.drain();
  }

  /**
   * Records that input went out under a mode the platform would not confirm.
   * Once per mode per session: it describes the platform, not the action, and
   * an entry per click would bury everything else in the log.
   */
  #noteUnverifiable(mode: 'mouse' | 'focus', detail: string): void {
    if (this.#unverifiableLogged.has(mode)) return;
    this.#unverifiableLogged.add(mode);
    this.#diagnostic('mode-unverifiable', detail, { mode });
  }

  crashReport(): CrashReport | null {
    return this.#crash;
  }

  /** Starts an observable action lifecycle on this session's monotonic clock. */
  beginAction(api: string, about?: { selector?: string }): string {
    return this.#actions.begin(api, about);
  }

  endAction(
    actionId: string,
    api: string,
    ok: boolean,
    about?: Omit<ActionEvent, 'actionId' | 'api' | 'ok' | 'timeMs' | 'observation'>,
  ): void {
    this.#actions.end(actionId, api, ok, about);
  }

  /** Runs a harness-level action and reports it, whichever way it ends. */
  async #rawDeviceAction(
    api: string,
    intent: ActionIntent,
    operations: readonly ExecutableDeviceOperation[],
  ): Promise<void> {
    this.operationTimeout(this.timeouts.action, api);
    const actionId = this.beginAction(api);
    const before = this.checkpoint();
    const plan: ExecutableActionPlan = Object.freeze({
      actionId,
      contractId: before.contractId,
      intent,
      checkpoint: before,
      requirements: Object.freeze([]),
      strategy: 'raw-physical-input',
      operations: Object.freeze([...operations]),
    });
    try {
      const executed = await this.executeDeviceOperations(plan.operations, before);
      const receipt: ActionReceipt = Object.freeze({
        intent,
        plan: recordActionPlan(plan, this.artifactSecurity.mode),
        before,
        after: this.checkpoint(),
        executed: Object.freeze(
          executed.map((operation) => recordDeviceOperation(operation, this.artifactSecurity.mode)),
        ),
        outcome: 'completed',
      });
      this.endAction(actionId, api, true, { receipt });
    } catch (error) {
      this.endAction(actionId, api, false, { error: actionErrorCode(error) });
      throw error;
    }
  }

  /** Runs a harness-level action and reports it, whichever way it ends. */
  async #act<T>(api: string, run: () => Promise<T>): Promise<T> {
    this.operationTimeout(this.timeouts.action, api);
    const actionId = this.beginAction(api);
    try {
      const result = await run();
      this.endAction(actionId, api, true);
      return result;
    } catch (error) {
      this.endAction(actionId, api, false, { error: actionErrorCode(error) });
      throw error;
    }
  }

  /** Public, bounded diagnostics log (oldest first). */
  diagnostics(): readonly SessionDiagnostic[] {
    return this.#evidence.diagnostics();
  }

  appLogs(): readonly AppLogEvent[] {
    return this.#evidence.appLogs();
  }

  ownedProcessResources(): import('./api.js').OwnedProcessResourceUsage | null {
    return this.#ownedProcessResources;
  }

  errorDiagnostics(extra?: Partial<ErrorDiagnostics>): ErrorDiagnostics {
    return {
      semanticTree: this.#attachment !== null,
      screenExcerpt: screenExcerpt(this.#vt),
      ...extra,
    };
  }

  assertOpen(): void {
    if (this.#closed) {
      throw new SessionClosedError('the harness was closed', {
        semanticTree: false,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Teardown

  close(): Promise<void> {
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    this.#lifecycle.requestTeardown();
    // Publish one terminal outcome for every announced action before the
    // emitter is closed. A later promise settlement becomes a no-op because
    // the action has already been removed from this registry.
    this.#actions.failPending('session-closed');
    this.#closed = true;
    this.#shellTracker.close(
      new SessionClosedError('the shell session was closed', {
        semanticTree: this.#attachment !== null,
      }),
    );
    this.#notifyChange();
    if (this.#negotiationTimer !== null) clearTimeout(this.#negotiationTimer);
    this.#settle();
    this.#flushLogDrops();
    try {
      await this.#resources.close();
      await this.#launchLease?.release();
      if (this.#ptyFailure !== null) throw this.#ptyFailure;
    } catch (error) {
      // A cleanup error is not automatically a leaked scarce resource. Fault
      // injection backends can prove their owned tree gone even when they
      // deliberately withhold ExitStatus; ResourceScope proves whether the
      // semantic endpoint itself closed. Only that conjunction permits safe
      // capacity reuse. Unknown/alive trees and endpoint failures stay held
      // until the host reclaims the poisoned worker epoch.
      let failure = error;
      if (this.#launchLease !== null && this.#brokerResourcesVerifiedGone(error)) {
        try {
          await this.#launchLease.release();
        } catch (releaseError) {
          failure = new AggregateError(
            [error, releaseError],
            'terminal cleanup and broker release failed',
            {
              cause: error,
            },
          );
        }
      }
      this.#lifecycle.fail(failure);
      throw failure;
    } finally {
      for (const waiter of [...this.#changeWaiters]) waiter.resolve();
      this.#emitter.clear();
    }
  }

  #brokerResourcesVerifiedGone(error: unknown): boolean {
    if (!(error instanceof ResourceCleanupError)) return false;
    if (error.failedResources.includes('semantic channel')) return false;
    if (this.#pty === null) return true;
    try {
      return this.#pty.treeState?.() === 'gone';
    } catch {
      return false;
    }
  }

  async #disposePty(pty: PtyProcess): Promise<void> {
    const supervisor =
      this.#processSupervisor ??
      new ProcessSupervisor(pty, {
        beforeInputClose: () => this.#closeTerminalResponseBridge(),
      });
    try {
      await supervisor.shutdown({
        deadline: performance.now() + CLOSE_GRACE_MS,
        gracefulMs: Math.min(500, CLOSE_GRACE_MS),
        beforeDispose: () => {
          this.#closeTerminalResponseBridge();
          this.#ownedProcessResources = pty.ownedProcessResources?.() ?? null;
        },
        ...(this.#lifecycle.backendStatus === null
          ? {}
          : { observedExit: this.#lifecycle.backendStatus }),
      });
    } catch (error) {
      // A real PTY exit closes the producer, but #finishExit still has to parse
      // its already-enqueued bytes before ResourceScope may dispose the VT.
      if (error instanceof ProcessLifecycleError && error.exitObserved) await this.#exitProcessing;
      throw error;
    }
    await this.exit;
  }

  #closeTerminalResponseBridge(): void {
    this.#terminalResponseAdmissionOpen = false;
    this.#detachTerminalResponse?.();
    this.#detachTerminalResponse = null;
  }

  // -------------------------------------------------------------------------
  // Internals

  /**
   * Milliseconds since the session started, from a monotonic clock: event
   * timestamps never jump backwards when the wall clock is adjusted, and never
   * reset for the life of the session (trace depends on this).
   */
  #now(): number {
    return performance.now() - this.#startedAt;
  }

  /**
   * Records one diagnostic and publishes it. The log is bounded and
   * oldest-first: a flooding adapter cannot grow it without bound.
   */
  /**
   * Mirrors the session's observable life into the debug log. Registered only
   * when debugging is on, so an ordinary session pays nothing.
   */
  #installDebugListeners(): void {
    const log = this.#debug;
    if (log === null) return;
    log.line(
      'api',
      `launch ${JSON.stringify(this.#options.command.join(' '))} ` +
        `${this.#vt.columns}x${this.#vt.rows} envMode=${this.#options.envMode ?? 'replace'}`,
    );
    this.#emitter.on('screen-revision', ({ revision }) =>
      log.line('vt', `screen revision ${revision}`),
    );
    this.#emitter.on('semantic-revision', ({ revision }) =>
      log.line('sem', `semantic revision ${revision} published (tree and marker paired)`),
    );
    this.#emitter.on('diagnostic', (entry) => log.diagnostic(entry));
    this.#emitter.on('exit', ({ code, signal }) =>
      log.line('api', `exited code=${String(code)} signal=${String(signal)}`),
    );
    this.#emitter.on('app-log', (entry) =>
      log.line(
        'app',
        `${entry.label ?? 'log'} | ${entry.line ?? `${entry.record?.level ?? '?'} ${entry.record?.message ?? ''}`}`,
      ),
    );
    if (log.logsIo) {
      this.#emitter.on('output', ({ data }) => log.line('io', `out ${formatBytes(data)}`));
      this.#emitter.on('input', ({ data, kind }) =>
        log.line('io', `in  ${kind} ${formatBytes(data)}`),
      );
    }
  }

  #diagnostic(code: DiagnosticCode, detail: string, about?: SessionDiagnosticContext): void {
    this.#evidence.diagnostic(code, detail, about);
  }

  #onAttach(attachment: SemanticAttachment): void {
    if (this.#settled) {
      this.#diagnostic(
        'protocol-violation',
        'an adapter attempted to attach after the session contract was frozen',
      );
      return;
    }
    // Anchor the two clocks against each other once, while both are being read
    // in the same instant.
    this.#clockAnchor = { epochMs: Date.now(), sessionMs: this.#now() };
    this.#attachment = attachment;
    this.#channel?.closeAdmission();
    this.#diagnostic(
      'adapter-attached',
      `adapter ${attachment.adapter.name}@${attachment.adapter.version} attached with capabilities [${attachment.capabilities.join(', ')}]`,
    );
    this.#pairing.setMarkerEnabled(attachment.markerEnabled);
    this.#settle();
  }

  #settleGenericAfterDiscovery(negotiationMs: number): void {
    if (this.#settled || this.#attachment !== null) return;
    this.#diagnostic(
      'negotiation-timeout',
      `adapter discovery closed after ${negotiationMs} ms and no admitted peer completed its bounded handshake; the frozen session contract is generic`,
    );
    this.#settle();
  }

  /**
   * Publishes one log line. The timestamp is when the driver read it, which
   * trails the write by up to a poll interval — documented on the event.
   */
  #publishLogLine(source: AppLogSource, line: string): void {
    // File-log teardown intentionally runs after process teardown. The public
    // session is already closed to new operations, but its event journal stays
    // attached until ResourceScope finishes this final drain.
    this.#publishAppLog({
      source: 'file',
      ...(source.label !== undefined ? { label: source.label } : {}),
      path: source.path,
      line,
      timeMs: this.#now(),
    });
  }

  /**
   * Publishes one adapter log record.
   *
   * Two things have to be reconciled. The record carries a wall-clock
   * timestamp, because that is the only clock an adapter and a driver can agree
   * on without negotiating one; the session timeline is monotonic milliseconds
   * since start. They are rebased through the offset measured at the handshake
   * and clamped into the session, so a skewed or adjusted wall clock cannot
   * place a record before the session began or in the future.
   *
   * The adapter also rate-limits at the source and leaves a gap in `seq` when
   * it drops; that gap is reported here, because only the adapter knows what it
   * threw away.
   */
  #publishLogRecord(record: LogRecord): void {
    if (this.#closed) return;

    if (this.#lastLogSeq !== null && record.seq <= this.#lastLogSeq) {
      // Strictly increasing within a session (contract): a repeated or
      // rewound seq means the adapter lost track of its own counter. The
      // record is refused rather than published, because a consumer counting
      // errors would otherwise count one twice; the channel survives, since a
      // miscounted record is a bug in the adapter, not hostile input.
      this.#diagnostic(
        'log-dropped',
        `refused a log record with seq ${record.seq}: the previous record was seq ${this.#lastLogSeq}, ` +
          'and seq must strictly increase within a session',
      );
      return;
    }
    if (this.#lastLogSeq !== null && record.seq > this.#lastLogSeq + 1) {
      const lost = record.seq - this.#lastLogSeq - 1;
      this.#diagnostic(
        'log-dropped',
        `the adapter dropped ${lost} log record${lost === 1 ? '' : 's'} before seq ${record.seq}: ` +
          'it was over the budget granted in the handshake',
        { count: lost },
      );
    }
    this.#lastLogSeq = record.seq;

    const now = this.#now();
    if (now - this.#logWindowStartedAt >= LOG_WINDOW_MS) {
      this.#flushLogDrops();
      this.#logWindowStartedAt = now;
      this.#logWindowRecords = 0;
    }
    const perWindow = Math.ceil((LOG_RECORDS_PER_SECOND * LOG_WINDOW_MS) / 1000);
    if (this.#logWindowRecords >= perWindow) {
      this.#logDroppedInWindow += 1;
      // A flood that stops would never report what it lost if the count waited
      // for the next record, so the window closes itself.
      if (this.#logDropTimer === null) {
        this.#logDropTimer = setTimeout(() => {
          this.#logDropTimer = null;
          this.#flushLogDrops();
        }, LOG_WINDOW_MS);
        this.#logDropTimer.unref?.();
      }
      return;
    }
    this.#logWindowRecords += 1;

    this.#publishAppLog({
      source: 'adapter',
      ...(record.logger !== undefined ? { label: record.logger } : {}),
      record,
      timeMs: this.#sessionTimeOf(record.ts),
    });
  }

  #publishAppLog(event: AppLogEvent): void {
    this.#evidence.appLog(event);
  }

  /** Rebases an adapter's epoch timestamp onto the session timeline. */
  #sessionTimeOf(epochMs: number): number {
    const anchor = this.#clockAnchor;
    const now = this.#now();
    if (anchor === null) return now;
    const rebased = anchor.sessionMs + (epochMs - anchor.epochMs);
    return Math.min(Math.max(rebased, 0), now);
  }

  /** Reports records the driver itself refused, once per window. */
  #flushLogDrops(): void {
    if (this.#logDropTimer !== null) {
      clearTimeout(this.#logDropTimer);
      this.#logDropTimer = null;
    }
    if (this.#logDroppedInWindow === 0) return;
    const dropped = this.#logDroppedInWindow;
    this.#logDroppedInWindow = 0;
    this.#diagnostic(
      'log-dropped',
      `refused ${dropped} log record${dropped === 1 ? '' : 's'} from the adapter: ` +
        `more than ${LOG_RECORDS_PER_SECOND} records per second arrived despite the negotiated budget`,
      { count: dropped },
    );
  }

  #publishSemantic(
    snapshot: SemanticSnapshot,
    changedNodes: ReadonlyMap<string, SemanticNode | undefined> | null,
  ): void {
    const composed = composeProviderEvidence(snapshot, this.#attachment?.providers ?? []);
    if (!composed.ok) {
      const failure =
        composed.problem.kind === 'lost'
          ? new CapabilityProviderLostError(
              composed.problem.message,
              this.errorDiagnostics({
                suggestion: 'restart the application and register the provider before launch',
              }),
            )
          : composed.problem.kind === 'conflict'
            ? new EvidenceConflictError(
                composed.problem.message,
                this.errorDiagnostics({
                  suggestion:
                    'inspect the competing authoritative producers and make them publish one equivalent fact for this revision',
                }),
              )
            : new CapabilityProviderViolationError(
                composed.problem.message,
                this.errorDiagnostics({
                  suggestion:
                    'make provider evidence agree with the production router and framework observations',
                }),
              );
      this.#providerFailure = failure;
      this.#diagnostic('adapter-guarantee-violation', failure.message, {
        revision: snapshot.revision,
      });
      this.#notifyChange();
      return;
    }
    snapshot = composed.snapshot;
    let effectiveChanges = changedNodes;
    if (changedNodes !== null) {
      const affected = new Set([
        ...changedNodes.keys(),
        ...this.#providerComposedNodeIds,
        ...composed.composedNodeIds,
      ]);
      const finalNodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
      effectiveChanges = new Map([...affected].map((id) => [id, finalNodes.get(id)] as const));
    }
    this.#providerComposedNodeIds = composed.composedNodeIds;
    this.#inputEvidence.noteSemanticCommit(snapshot.revision);
    if (composed.inputModes !== undefined) {
      const observedModes = this.#vt.modes();
      const disagreement =
        observedModes.mouseTracking !== 'unknown' &&
        observedModes.mouseTracking !== composed.inputModes.value.mouseTracking
          ? `mouse tracking (${observedModes.mouseTracking} vs ${composed.inputModes.value.mouseTracking})`
          : observedModes.mouseEncoding !== 'unknown' &&
              observedModes.mouseEncoding !== composed.inputModes.value.mouseEncoding
            ? `mouse encoding (${observedModes.mouseEncoding} vs ${composed.inputModes.value.mouseEncoding})`
            : observedModes.focusReporting !== 'unknown' &&
                observedModes.focusReporting !== composed.inputModes.value.focusReporting
              ? `focus reporting (${observedModes.focusReporting} vs ${composed.inputModes.value.focusReporting})`
              : null;
      if (disagreement !== null) {
        const failure = new EvidenceConflictError(
          `provider ${composed.inputModes.providerId} terminal input modes disagree with VT observation: ${disagreement}`,
          this.errorDiagnostics({
            suggestion:
              "make the provider report the application's production parser configuration for this exact committed revision",
          }),
        );
        this.#providerFailure = failure;
        this.#diagnostic('adapter-guarantee-violation', failure.message, {
          revision: snapshot.revision,
        });
        this.#notifyChange();
        return;
      }
    }
    const guaranteeFailure = this.#guaranteeFailure(snapshot);
    if (guaranteeFailure !== null) {
      this.#providerFailure = guaranteeFailure;
      this.#diagnostic('adapter-guarantee-violation', guaranteeFailure.message, {
        revision: snapshot.revision,
      });
      this.#notifyChange();
      return;
    }
    this.#providerInputModes = composed.inputModes?.value ?? null;
    if (this.#index === null || effectiveChanges === null)
      this.#index = new SemanticIndex(snapshot);
    else this.#index.update(snapshot, effectiveChanges);
    this.#observationSequence += 1;
    this.#emitter.emit('semantic-revision', {
      revision: snapshot.revision,
      timeMs: this.#now(),
      snapshot,
    });
    this.#notifyChange();
  }

  /** A frozen guarantee may resolve to known/absent, never unknown/unsupported. */
  #guaranteeFailure(snapshot: SemanticSnapshot): AdapterGuaranteeViolationError | null {
    const contract = this.#contract;
    const committedUnknown = (
      status: string,
      fact: string,
      nodeId?: string,
    ): AdapterGuaranteeViolationError | null => {
      if (status !== 'unknown') return null;
      const subject = nodeId === undefined ? 'snapshot' : `node ${JSON.stringify(nodeId)}`;
      return new AdapterGuaranteeViolationError(
        `${subject} published transient unknown evidence for ${fact} into committed revision ${snapshot.revision}`,
        this.errorDiagnostics({
          suggestion:
            'publish only after revision evidence settles; use unsupported for facts outside the frozen contract',
        }),
      );
    };
    const coordinateUnknown = committedUnknown(snapshot.coordinateSpace.status, 'coordinate-space');
    if (coordinateUnknown !== null) return coordinateUnknown;
    const hitGridUnknown = committedUnknown(snapshot.hitGrid.status, 'pointer-hit-testing');
    if (hitGridUnknown !== null) return hitGridUnknown;
    for (const node of snapshot.nodes) {
      const displayedUnknown = committedUnknown(
        node.geometry.displayed.status,
        'displayed',
        node.id,
      );
      if (displayedUnknown !== null) return displayedUnknown;
      const intendedUnknown = committedUnknown(
        node.geometry.intendedRect.status,
        'intended-geometry',
        node.id,
      );
      if (intendedUnknown !== null) return intendedUnknown;
      const clippedUnknown = committedUnknown(
        node.geometry.visibleRect.status,
        'clipped-geometry',
        node.id,
      );
      if (clippedUnknown !== null) return clippedUnknown;
    }
    if (contract === null) return null;
    const broken = (
      status: string,
      capability: SessionCapabilityId,
      nodeId?: string,
    ): AdapterGuaranteeViolationError | null => {
      if (contract.capabilities[capability].status !== 'supported') return null;
      if (status === 'known' || status === 'absent') return null;
      const subject = nodeId === undefined ? 'snapshot' : `node ${JSON.stringify(nodeId)}`;
      return new AdapterGuaranteeViolationError(
        `${subject} published ${status} for guaranteed capability ${capability}`,
        this.errorDiagnostics({
          suggestion:
            'use a certified adapter that supplies the negotiated evidence for every committed revision',
        }),
      );
    };
    for (const node of snapshot.nodes) {
      const intended = broken(node.geometry.intendedRect.status, 'intended-geometry', node.id);
      if (intended !== null) return intended;
      const clipped = broken(node.geometry.visibleRect.status, 'clipped-geometry', node.id);
      if (clipped !== null) return clipped;
    }
    return broken(snapshot.hitGrid.status, 'pointer-hit-testing');
  }

  #settle(): void {
    if (this.#settled) return;
    this.#contract = this.#buildContract();
    if (this.#index !== null) {
      const guaranteeFailure = this.#guaranteeFailure(this.#index.snapshot);
      if (guaranteeFailure !== null) {
        this.#providerFailure = guaranteeFailure;
        this.#index = null;
        this.#diagnostic('adapter-guarantee-violation', guaranteeFailure.message);
      }
    }
    this.#settled = true;
    if (this.#negotiationTimer !== null) {
      clearTimeout(this.#negotiationTimer);
      this.#negotiationTimer = null;
    }
    const waiters = this.#settleWaiters;
    this.#settleWaiters = [];
    for (const resolve of waiters) resolve();
    // Launch negotiation waits on the same causal change journal as every
    // other session observer. A hello can settle the capability contract
    // before the adapter publishes its first frame, so settlement itself must
    // wake that journal rather than relying on unrelated terminal output.
    this.#notifyChange();
  }

  #requireContract(): EffectiveSessionContract {
    if (this.#contract === null) throw new Error('session contract has not settled');
    return this.#contract;
  }

  #buildContract(): EffectiveSessionContract {
    return buildSessionContract({
      sessionId: this.sessionId,
      attachment: this.#attachment,
      terminalProfile: this.#vt.profile.id,
      platform: process.platform,
      ...(this.#options.modesObservable === undefined
        ? {}
        : { modesObservable: this.#options.modesObservable }),
    });
  }

  /**
   * Publishes an exit once the output that preceded it has been parsed. The pty
   * reports the exit as soon as the process is gone, which is routinely before
   * the last chunk it wrote — the very chunk carrying the stack trace.
   */
  async #finishExit(status: ExitStatus): Promise<void> {
    if (this.#lifecycle.status !== null) return;
    // Root exit is not process-tree exit. POSIX descendants can retain the
    // session and its resources after the leader is reaped; publish the public
    // exit only after the supervisor has proven that exact owned group gone.
    // close() cancels this same owned confirmation at its absolute deadline.
    if ((await this.#processSupervisor?.waitForOwnedTreeExit()) === false) {
      const failure =
        this.#processSupervisor?.ownedTreeExitFailure() ??
        new ProcessLifecycleError('cleanup-failed', 'process tree exit could not be confirmed', {
          exitObserved: true,
        });
      if (this.#lifecycle.fail(failure)) this.#notifyChange();
      return;
    }
    // No member of the owned process tree can consume new terminal input from
    // this point. Keep the listener alive until PTY disposal only so an xterm
    // reply already scheduled in a later task is classified diagnostically.
    this.#terminalResponseAdmissionOpen = false;
    if (this.#pty?.lifecycle?.outputDrain === 'eof') {
      // Wait for the producer, then the parser. The pty reports the exit as
      // soon as the process is gone, so the last chunk it wrote can still be
      // in flight; draining the parser first drains only what happened to have
      // arrived, and the final line is lost after the exit is published.
      //
      // Only on this branch. A backend without EOF coupling has no moment at
      // which its producer is known to be finished — ConPTY's socket closes on
      // a timer during teardown, not at the child's exit — so waiting here
      // would wait for teardown on every natural exit and delay publication.
      const producerEnded = this.#pty.outputEnded;
      if (producerEnded !== undefined) await producerEnded;
      await this.#vt.drain();
      // Settling is not ending. A producer torn down with bytes still unread
      // settles the same promise as one whose source ended, and the screen
      // that results is missing its last output with nothing to say so. Naming
      // it here is the difference between a test that fails for a reason and
      // one that fails on a line that looks fine.
      if (this.#pty.sawOutputEnd?.() === false) {
        this.#diagnostic(
          'truncated-output',
          `the ${this.#backend.name} output producer was torn down before its source ended; ` +
            'output written shortly before exit may be missing from the screen',
        );
      }
    } else {
      this.#diagnostic(
        'degraded-output-drain',
        `PTY backend ${this.#backend.name} does not expose an EOF-coupled exit; final output drain covers bytes already delivered to the parser`,
      );
      await this.#vt.drain();
    }
    this.#onExit(status);
  }

  #onExit(status: ExitStatus): void {
    this.#lifecycle.complete(status, (retained, unexpected) => {
      this.#shellTracker.close(
        new ProcessExitedError(
          `the shell process exited before the command completed (code ${String(retained.code)})`,
          this.errorDiagnostics(),
        ),
      );
      if (unexpected) {
        this.#crash = this.#buildCrashReport(retained);
        this.#emitter.emit('crash', this.#crash);
      }
      this.#emitter.emit('exit', { ...retained, timeMs: this.#now() });
      this.#settle();
      this.#notifyChange();
    });
  }

  #buildCrashReport(status: ExitStatus): CrashReport {
    return this.#evidence.crashReport({
      exit: status,
      screenLines: this.#vt.allLines(),
      lastSemanticTree: this.#index?.snapshot ?? null,
    });
  }

  #assertAlive(operation: string): void {
    this.#lifecycle.throwIfFailed();
    if (this.#ptyFailure !== null) throw this.#ptyFailure;
    const status = this.#lifecycle.status;
    if (status === null) return;
    const crash = this.#crash;
    throw new ProcessExitedError(
      `${operation} cannot make progress: the program exited with code ${String(status.code)}` +
        (status.signal === null ? '' : ` (signal ${status.signal})`),
      this.errorDiagnostics(
        crash === null
          ? {}
          : {
              // The tail beats the live grid here: a stack trace long enough to
              // scroll is exactly the case worth reporting.
              screenExcerpt: crash.screenTail.slice(-CRASH_EXCERPT_LINES).join('\n'),
              suggestion:
                'the program died on its own; call crashReport() for the full tail, the last semantic tree and the inputs that preceded it',
            },
      ),
    );
  }

  #notifyChange(): void {
    for (const waiter of [...this.#changeWaiters]) waiter.resolve();
  }

  async #sendFocus(focused: boolean): Promise<void> {
    const reporting = this.modes().focusReporting;
    if (reporting === 'off') {
      throw new InputModeDisabledError(
        `the program has not enabled focus reporting, so ${focused ? 'focus' : 'blur'}() has nothing to deliver`,
        this.errorDiagnostics({
          suggestion: 'the application under test must enable CSI ? 1004 h',
        }),
      );
    }
    if (reporting === 'unknown') {
      throw new InputModeDisabledError(
        `the terminal focus-reporting mode is not observable, so ${focused ? 'focus' : 'blur'}() cannot be encoded authoritatively`,
        this.errorDiagnostics({
          suggestion:
            'use a PTY backend that exposes CSI ? 1004 state; Termwright does not guess input modes',
        }),
      );
    }
    await this.sendInput(encodeFocus(focused), 'raw');
  }

  #createScrollbackApi(): ScrollbackApi {
    const buffer = (): { baseY: number; viewportY: number; length: number } => {
      const active = this.#vt.terminal.buffer.active;
      return {
        baseY: active.baseY,
        viewportY: active.viewportY,
        length: active.length,
      };
    };
    const lineText = (absolute: number): string | null => {
      const index = absolute - this.#vt.retainedFloor;
      if (index < 0) return null;
      return this.#vt.terminal.buffer.active.getLine(index)?.translateToString(true) ?? null;
    };
    const session = this;
    return Object.freeze({
      get length(): number {
        return buffer().baseY;
      },
      get retainedFloor(): number {
        return session.#vt.retainedFloor;
      },
      move(opts: { lines: number }): void {
        session.assertOpen();
        session.#vt.terminal.scrollLines(opts.lines);
      },
      position(): number {
        return buffer().viewportY;
      },
      text(opts?: { from?: number; to?: number }): string {
        const floor = session.#vt.retainedFloor;
        const from = opts?.from ?? floor;
        const to = opts?.to ?? floor + buffer().length;
        if (from < floor) {
          throw new HistoryTruncatedError(
            `scrollback line ${from} was evicted; the oldest retained line is ${floor}`,
            session.errorDiagnostics({
              suggestion: 'raise scrollbackLines when launching the session',
            }),
          );
        }
        const lines: string[] = [];
        for (let absolute = from; absolute < to; absolute += 1) {
          const text = lineText(absolute);
          if (text === null) break;
          lines.push(text);
        }
        return lines.join('\n');
      },
      search(text: string | RegExp): readonly { line: number; match: string }[] {
        const floor = session.#vt.retainedFloor;
        const out: { line: number; match: string }[] = [];
        for (let index = 0; index < buffer().length; index += 1) {
          const line = session.#vt.terminal.buffer.active.getLine(index)?.translateToString(true);
          if (line === undefined) continue;
          if (text instanceof RegExp) {
            const match = new RegExp(text.source, text.flags.replace('g', '')).exec(line);
            if (match !== null) out.push({ line: floor + index, match: match[0] });
          } else if (line.includes(text)) {
            out.push({ line: floor + index, match: text });
          }
        }
        return Object.freeze(out);
      },
    });
  }

  #createSelectionApi(): SelectionApi {
    const session = this;
    return Object.freeze({
      selectCells(range: {
        start: { row: number; column: number };
        end: { row: number; column: number };
      }): void {
        session.assertOpen();
        session.#selectionRange = range;
      },
      copy(): string {
        const range = session.#selectionRange;
        if (range === null) return '';
        const rows = captureRows(session.#vt);
        const top = Math.min(range.start.row, range.end.row);
        const bottom = Math.max(range.start.row, range.end.row);
        const left = Math.min(range.start.column, range.end.column);
        const right = Math.max(range.start.column, range.end.column);
        return textInRect(rows, {
          row: top,
          column: left,
          width: right - left + 1,
          height: bottom - top + 1,
        });
      },
      clear(): void {
        session.#selectionRange = null;
      },
    });
  }
}

/**
 * Variables a POSIX child genuinely needs under `envMode: 'replace'`.
 * Deliberately short: the tokens, cloud credentials and CI secrets sitting in a
 * test runner's environment are not the application under test's business.
 */
const POSIX_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SHELL', 'TMPDIR', 'USER'] as const;

/**
 * What the child is told it is talking to.
 *
 * Not inherited, and not absent: the child's terminal is our emulator, whose
 * capabilities are known exactly, so passing on whatever terminal (if any)
 * launched the test run would describe the wrong thing. `@xterm/headless`
 * answers to `xterm-256color` and renders 24-bit colour, and both statements
 * are true on every platform the driver runs on.
 *
 * The driver sets this explicitly on every platform rather than inheriting a
 * runner-specific terminal description or delegating policy to the native
 * PTY implementation.
 */
const EMULATED_TERM = 'xterm-256color';
const EMULATED_COLORTERM = 'truecolor';

/**
 * The same list for Windows, which needs a different and longer one.
 *
 * This is not a portability nicety: a Node process started without
 * `SystemRoot` **aborts** rather than reporting an error, so a POSIX-shaped
 * allowlist makes every child die with exit code 134 and no explanation.
 * `PATHEXT` and `COMSPEC` decide whether an executable can be found at all,
 * and the profile variables are what a program uses instead of `HOME`.
 */
const WINDOWS_ENV_KEYS = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'TEMP',
  'TMP',
  'COMSPEC',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'OS',
] as const;

/** The allowlist for the platform the driver is running on. */
function safeEnvKeys(): readonly string[] {
  return process.platform === 'win32' ? WINDOWS_ENV_KEYS : POSIX_ENV_KEYS;
}

/**
 * The smallest environment a child can actually start in on this platform.
 *
 * Spawning with just `PATH` reads as admirably minimal and is fine on POSIX,
 * but on Windows a Node child without `SystemRoot` aborts inside CSPRNG
 * initialization with exit code 134 before running a line of code — no error,
 * no output, just a number that looks like the program failed. Anywhere that
 * spawns a helper process should take this instead of writing its own list.
 */
export function inheritedSpawnEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of safeEnvKeys()) {
    const value = process.env[key];
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

/**
 * Rejects a launch whose paths do not exist, before a pty is opened.
 *
 * A failed exec would otherwise look like an application that exited with a
 * blank screen. Naming the missing path costs one `stat` and turns that into
 * an actionable answer before a native session is allocated.
 *
 * Only a command that *is* a path is checked. Resolving a bare name would mean
 * reimplementing the platform's lookup (`PATH`, and `PATHEXT` on Windows), and
 * a wrong "not found" for a program that exists is worse than the blank screen
 * this replaces.
 */
function assertLaunchPathsExist(command: readonly string[], cwd: string | undefined): void {
  const fail = (what: string, path: string): never => {
    throw new NotFoundError(`${what} does not exist: ${path}`, {
      semanticTree: false,
      suggestion: 'check the path; the session was not started',
    });
  };
  if (cwd !== undefined && !existsSync(cwd)) fail('the working directory', cwd);
  const file = command[0];
  if (file !== undefined && (file.includes('/') || file.includes('\\')) && !existsSync(file)) {
    fail('the command', file);
  }
}

/**
 * Builds the child environment; the handshake variables are added afterwards.
 *
 * Exported for tests only — the public surface is `index.ts`.
 */
export function buildChildEnv(
  mode: EnvMode,
  overrides: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (mode === 'inherit') {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
  } else {
    // Windows environment names are case-insensitive and the OS decides the
    // casing, so the allowlist is matched against the real keys rather than
    // read by an assumed spelling.
    const insensitive = process.platform === 'win32';
    const wanted = new Set(safeEnvKeys().map((key) => (insensitive ? key.toLowerCase() : key)));
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (wanted.has(insensitive ? key.toLowerCase() : key)) env[key] = value;
    }
  }
  // Set in both modes and before the overrides: these describe the emulator
  // the child is attached to, which is ours whatever the parent's terminal was
  // — and an explicit `env` entry still wins, for a caller testing what their
  // program does under a different TERM.
  env['TERM'] = EMULATED_TERM;
  env['COLORTERM'] = EMULATED_COLORTERM;
  for (const [key, value] of Object.entries(overrides ?? {})) env[key] = value;
  return env;
}

/** Lines of the crash excerpt embedded in a process-exited error. */
const CRASH_EXCERPT_LINES = 20;

/** Groups a failure by its code, not by its prose. */
function actionErrorCode(error: unknown): string {
  if (error instanceof TermwrightError) return error.code;
  return error instanceof Error ? error.name : 'unknown';
}

/** Converts a Windows file-URI pathname back to the native path exposed by the fixture. */
function normalizeShellCwd(cwd: string | null): string | null {
  if (cwd === null || process.platform !== 'win32') return cwd;
  const withoutUriRoot = /^\/[A-Za-z]:\//u.test(cwd) ? cwd.slice(1) : cwd;
  return withoutUriRoot.replaceAll('/', '\\');
}
