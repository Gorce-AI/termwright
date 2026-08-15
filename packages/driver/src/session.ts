/**
 * Session core: `launchTerminal` and the {@link TerminalHarness} it returns.
 *
 * One session owns one PTY, one headless emulator, one semantic endpoint and
 * one revision timeline. Everything observable is revision-stamped, and every
 * wait is driven by revisions or process events — the driver never sleeps.
 */
import { randomUUID } from 'node:crypto';
import type {
  CellSnapshot,
  DiagnosticCode,
  EnvMode,
  SessionDiagnostic,
  ExitStatus,
  ErrorDiagnostics,
  LaunchOptions,
  Locator,
  RoleLocatorOptions,
  ScreenSnapshot,
  ScrollbackApi,
  SelectionApi,
  SessionCapabilities,
  SessionEvents,
  TerminalHarness,
  TerminalModes,
  TextLocatorOptions,
  TimeoutClasses,
  WaitOptions,
} from './api.js';
import type { SemanticRole, SemanticSnapshot } from '@termwright/protocol';
import {
  DEFAULT_LIMITS,
  DEFAULT_NEGOTIATION_MS,
  ENV_ENDPOINT,
  ENV_PROTOCOL,
  ENV_TOKEN,
  PROTOCOL_VERSION,
  generateToken,
  verifyMarkerPayload,
} from '@termwright/protocol';
import {
  HistoryTruncatedError,
  ProtocolViolationError,
  ProcessExitedError,
  SessionClosedError,
  TimeoutError,
  UnsupportedActionError,
} from './errors.js';
import { SessionEventEmitter } from './events.js';
import { encodeFocus, encodeKeys, encodePaste, encodeText } from './keys.js';
import { LocatorImpl, type LocatorContext } from './locator.js';
import { SemanticIndex, textInRect } from './matching.js';
import { RevisionPairing } from './pairing.js';
import { createNodePtyBackend, type PtyBackend, type PtyProcess } from './pty.js';
import { captureRows, captureScreen, screenExcerpt, type CapturedRow } from './screen.js';
import { SemanticChannel, type SemanticAttachment } from './semantic.js';

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

/** Quiet window used by `waitForStable`, per requested frame. */
const STABLE_FRAME_MS = 50;

/** Quiet window the `waitForReady` fallback treats as "settled into a prompt". */
const READY_QUIET_MS = 150;

/** Quiet window that counts as idle output. */
const IDLE_QUIET_MS = 100;

/** How long a half-paired semantic revision is kept before it is dropped. */
const PAIRING_TIMEOUT_MS = 1_000;

/** Bounded diagnostics log: a flooding adapter cannot grow it without bound. */
const MAX_DIAGNOSTICS = 200;

/** Upper bound on how long `close()` waits for the child to hang up. */
const CLOSE_GRACE_MS = 2_000;

/** Options accepted by {@link launchTerminal}, plus the injectable backend. */
export interface LaunchTerminalOptions extends LaunchOptions {
  /** Defaults to `@lydell/node-pty`; swapped by component-testing harnesses. */
  readonly backend?: PtyBackend;
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
 * `semanticNegotiationMs` the session settles as generic (`semanticTree:
 * false`) and keeps working with grid locators.
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
  if (options.command.length === 0) {
    throw new TypeError('launchTerminal requires a non-empty command');
  }
  const session = new TerminalSession(options);
  await session.start();
  return session;
}

interface ChangeWaiter {
  resolve(): void;
  timer: NodeJS.Timeout;
}

class TerminalSession implements TerminalHarness, LocatorContext {
  readonly sessionId = randomUUID();
  readonly timeouts: Required<TimeoutClasses>;
  readonly events: SessionEvents;
  readonly scrollback: ScrollbackApi;
  readonly selection: SelectionApi;
  readonly exit: Promise<ExitStatus>;

  readonly #options: LaunchTerminalOptions;
  readonly #emitter: SessionEventEmitter;
  readonly #vt: VtScreen;
  readonly #backend: PtyBackend;
  readonly #token = generateToken();
  readonly #pairing: RevisionPairing;
  readonly #diagnosticsLog: SessionDiagnostic[] = [];
  readonly #changeWaiters = new Set<ChangeWaiter>();
  readonly #startedAt = performance.now();

  #channel: SemanticChannel | null = null;
  #pty: PtyProcess | null = null;
  #attachment: SemanticAttachment | null = null;
  #index: SemanticIndex | null = null;
  #settled = false;
  #settleWaiters: (() => void)[] = [];
  #negotiationTimer: NodeJS.Timeout | null = null;
  #closed = false;
  #exitStatus: ExitStatus | null = null;
  #resolveExit: ((status: ExitStatus) => void) | null = null;
  #lastOutputAt = Date.now();
  #violation: ProtocolViolationError | null = null;
  #selectionRange: { start: { row: number; column: number }; end: { row: number; column: number } } | null = null;

  constructor(options: LaunchTerminalOptions) {
    this.#options = options;
    this.timeouts = resolveTimeouts(options.timeouts);
    this.#emitter = new SessionEventEmitter((error) =>
      this.#diagnostic('listener-error', `a session event listener threw: ${String(error)}`),
    );
    this.events = this.#emitter;
    this.#backend = options.backend ?? createNodePtyBackend();
    this.#vt = new VtScreen({
      columns: options.columns ?? 100,
      rows: options.rows ?? 30,
      scrollbackLines: options.scrollbackLines ?? 2_000,
    });
    this.#pairing = new RevisionPairing({
      maxPending: DEFAULT_LIMITS.maxQueuedFrames,
      pairingTimeoutMs: PAIRING_TIMEOUT_MS,
      onPublish: (paired) => this.#publishSemantic(paired.snapshot),
      onDiagnostic: (code, detail, revision) => this.#diagnostic(code, detail, revision),
    });
    this.exit = new Promise<ExitStatus>((resolve) => {
      this.#resolveExit = resolve;
    });
    this.scrollback = this.#createScrollbackApi();
    this.selection = this.#createSelectionApi();
  }

  /** Creates the endpoint, spawns the child and starts the negotiation window. */
  async start(): Promise<void> {
    this.#channel = await SemanticChannel.listen({
      sessionId: this.sessionId,
      token: this.#token,
      limits: DEFAULT_LIMITS,
      hooks: {
        onAttach: (attachment) => this.#onAttach(attachment),
        onSnapshot: (snapshot) => this.#pairing.offerSnapshot(snapshot),
        onCommit: (revision) =>
          this.#diagnostic(
            'revision-commit',
            `the adapter reported committing revision ${revision}; pairing still waits for its render marker`,
            revision,
          ),
        onDiagnostic: (code, detail, revision) => this.#diagnostic(code, detail, revision),
        onProtocolViolation: (error) => {
          this.#violation = error;
          this.#diagnostic('protocol-violation', error.message);
          this.#settle();
        },
      },
    });

    this.#vt.onRevision((revision) => {
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

    const env = buildChildEnv(this.#options.envMode ?? 'replace', this.#options.env);
    env[ENV_ENDPOINT] = this.#channel.endpoint;
    env[ENV_TOKEN] = this.#token;
    env[ENV_PROTOCOL] = String(PROTOCOL_VERSION);

    this.#pty = this.#backend.spawn({
      command: this.#options.command,
      ...(this.#options.cwd !== undefined ? { cwd: this.#options.cwd } : {}),
      env,
      columns: this.#vt.columns,
      rows: this.#vt.rows,
    });

    this.#pty.onData((data) => {
      this.#lastOutputAt = Date.now();
      this.#emitter.emit('output', { data, timeMs: this.#now() });
      void this.#vt.write(data);
    });
    this.#pty.onExit((status) => this.#onExit(status));

    const negotiationMs = this.#options.semanticNegotiationMs ?? DEFAULT_NEGOTIATION_MS;
    this.#negotiationTimer = setTimeout(() => {
      if (this.#attachment === null) {
        this.#diagnostic(
          'negotiation-timeout',
          `no adapter completed the handshake within ${negotiationMs} ms; continuing as a generic session`,
        );
      }
      this.#settle();
    }, negotiationMs);
    this.#negotiationTimer.unref?.();
  }

  // -------------------------------------------------------------------------
  // Observation

  capabilities(): SessionCapabilities {
    return Object.freeze({
      semanticTree: this.#attachment !== null,
      ...(this.#attachment !== null ? { adapter: this.#attachment.adapter } : {}),
      capabilities: this.#attachment?.capabilities ?? Object.freeze([]),
      platform: process.platform,
    });
  }

  screen(): ScreenSnapshot {
    this.assertOpen();
    return captureScreen(this.#vt);
  }

  semanticTree(): SemanticSnapshot | null {
    return this.#index?.snapshot ?? null;
  }

  cell(pos: { row: number; column: number }): CellSnapshot {
    return this.screen().cell(pos.row, pos.column);
  }

  title(): string {
    return this.#vt.title;
  }

  // -------------------------------------------------------------------------
  // Locators

  getByRole(role: SemanticRole, opts?: RoleLocatorOptions): Locator {
    const name = opts?.name === undefined ? undefined : textMatcher(opts.name, opts.exact ?? false);
    return new LocatorImpl(this, roleQuery(role, name, opts?.state ?? {}));
  }

  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return new LocatorImpl(this, labelQuery(textMatcher(text, opts?.exact ?? false)));
  }

  getByText(text: string | RegExp, opts?: TextLocatorOptions): Locator {
    const matcher = textMatcher(text, opts?.exact ?? false);
    const style: StylePredicates | undefined =
      opts?.fg !== undefined || opts?.bg !== undefined || opts?.attributes !== undefined
        ? {
            ...(opts.fg !== undefined ? { fg: opts.fg } : {}),
            ...(opts.bg !== undefined ? { bg: opts.bg } : {}),
            ...(opts.attributes !== undefined ? { attributes: opts.attributes } : {}),
          }
        : undefined;
    // Style predicates and occurrence selection are grid concepts: they force
    // generic matching even in a semantic session.
    const generic = style !== undefined || opts?.occurrence !== undefined || this.#index === null;
    if (generic) return new LocatorImpl(this, gridQuery(matcher, opts?.occurrence, style));
    return new LocatorImpl(this, textQuery(matcher));
  }

  getByTestId(testId: string): Locator {
    return new LocatorImpl(this, parseSelector(`#${testId}`));
  }

  locator(selector: string): Locator {
    return new LocatorImpl(this, parseSelector(selector));
  }

  locatorForRef(ref: string): Locator {
    const parsed = parseRef(ref);
    if (parsed === null) {
      throw new UnsupportedActionError(
        `ref ${JSON.stringify(ref)} is not a termwright ref`,
        this.errorDiagnostics({
          suggestion: "refs look like 'n8@42' (semantic node) or 'grid:1,2,9,1@7' (grid match)",
        }),
      );
    }
    // A ref identifies one node, so it is resolved by identity rather than by
    // re-querying role+name — two buttons with the same name stay distinct.
    return new LocatorImpl(this, refQuery(parsed));
  }

  // -------------------------------------------------------------------------
  // Input

  async press(keys: string): Promise<void> {
    await this.sendInput(encodeKeys(keys, this.modes()), 'key');
  }

  async type(text: string): Promise<void> {
    await this.sendInput(encodeText(text), 'key');
  }

  async paste(text: string): Promise<void> {
    await this.sendInput(encodePaste(text, this.modes().bracketedPaste), 'paste');
  }

  async write(bytes: Uint8Array | string): Promise<void> {
    const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    await this.sendInput(data, 'raw');
  }

  async focus(): Promise<void> {
    await this.#sendFocus(true);
  }

  async blur(): Promise<void> {
    await this.#sendFocus(false);
  }

  async signal(sig: 'INT' | 'TERM' | 'KILL' | 'HUP'): Promise<void> {
    this.assertOpen();
    this.#pty?.signal(sig);
    await Promise.resolve();
  }

  async resize(size: { columns: number; rows: number }): Promise<void> {
    this.assertOpen();
    if (size.columns <= 0 || size.rows <= 0) {
      throw new UnsupportedActionError(`resize() needs positive dimensions, received ${size.columns}x${size.rows}`, {
        semanticTree: this.#attachment !== null,
      });
    }
    this.#pty?.resize(size.columns, size.rows);
    this.#vt.resize(size.columns, size.rows);
    this.#emitter.emit('resize', { columns: size.columns, rows: size.rows, timeMs: this.#now() });
    // A resize is only observable once the child has repainted.
    await this.waitForStable({ frames: 2, timeout: this.timeouts.action }).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Waits

  async waitForText(text: string | RegExp, opts?: WaitOptions): Promise<void> {
    const matcher = textMatcher(text, false);
    const deadline = Date.now() + (opts?.timeout ?? this.timeouts.text);
    const matches = (): boolean => {
      const screenText = captureRows(this.#vt)
        .map((row) => row.text)
        .join('\n');
      if (matcher.kind === 'regex') {
        return new RegExp(matcher.source.source, matcher.source.flags.replace('g', '')).test(screenText);
      }
      return screenText.includes(matcher.text);
    };
    for (;;) {
      if (matches()) return;
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          `text ${text instanceof RegExp ? String(text) : JSON.stringify(text)} never appeared on screen`,
          this.errorDiagnostics({ suggestion: 'check the screen excerpt below for the text the program actually printed' }),
        );
      }
      this.#assertAlive('waitForText');
      await this.waitForChange(deadline);
    }
  }

  async waitForRender(opts: { after: number } & WaitOptions): Promise<void> {
    const deadline = Date.now() + (opts.timeout ?? this.timeouts.action);
    while (this.#vt.revision <= opts.after) {
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          `no render after revision ${opts.after} (still at ${this.#vt.revision})`,
          this.errorDiagnostics(),
        );
      }
      this.#assertAlive('waitForRender');
      await this.waitForChange(deadline);
    }
  }

  async waitForStable(opts?: { frames?: number } & WaitOptions): Promise<void> {
    const frames = Math.max(1, opts?.frames ?? 2);
    const quiet = frames * STABLE_FRAME_MS;
    const deadline = Date.now() + (opts?.timeout ?? this.timeouts.action);
    for (;;) {
      const before = this.#vt.revision;
      const semanticBefore = this.#pairing.revision;
      await this.waitForChange(Math.min(deadline, Date.now() + quiet));
      const unchanged = this.#vt.revision === before && this.#pairing.revision === semanticBefore;
      if (unchanged && !this.#pairing.hasPendingRender) return;
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          `the screen never settled for ${quiet} ms`,
          this.errorDiagnostics({
            suggestion: 'raise the timeout, or assert on a concrete locator instead of waiting for silence',
          }),
        );
      }
    }
  }

  async waitForIdle(opts?: WaitOptions): Promise<void> {
    const deadline = Date.now() + (opts?.timeout ?? this.timeouts.idle);
    for (;;) {
      const since = Date.now() - this.#lastOutputAt;
      if (since >= IDLE_QUIET_MS) return;
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          `the program kept writing output for ${opts?.timeout ?? this.timeouts.idle} ms`,
          this.errorDiagnostics(),
        );
      }
      await this.waitForChange(Math.min(deadline, Date.now() + (IDLE_QUIET_MS - since)));
    }
  }

  async waitForReady(opts?: WaitOptions): Promise<void> {
    this.assertOpen();
    const deadline = Date.now() + (opts?.timeout ?? this.timeouts.ready);
    for (;;) {
      const shell = this.#vt.shellIntegration();
      if (shell.supported) {
        if (shell.ready) {
          this.#diagnostic(
            'ready-strategy',
            `ready from shell integration: last OSC 133 mark was ${String(shell.lastMark)}`,
          );
          return;
        }
      } else if (Date.now() - this.#lastOutputAt >= READY_QUIET_MS && this.#vt.revision > 0) {
        // No shell integration: the honest fallback is "the program stopped
        // writing", which is a heuristic and is reported as one.
        this.#diagnostic(
          'ready-strategy',
          `ready from the settled-screen heuristic: no output for ${READY_QUIET_MS} ms and no OSC 133 marks were seen`,
        );
        return;
      }
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          shell.supported
            ? `the shell reported a running command (last OSC 133 mark ${String(shell.lastMark)}) and never returned to a prompt`
            : `the program never settled into a prompt within ${opts?.timeout ?? this.timeouts.ready} ms`,
          this.errorDiagnostics({
            suggestion: 'wait for a concrete locator or text instead, or raise the ready timeout',
          }),
        );
      }
      this.#assertAlive('waitForReady');
      await this.waitForChange(Math.min(deadline, Date.now() + READY_QUIET_MS));
    }
  }

  async waitForExit(opts?: WaitOptions): Promise<ExitStatus> {
    if (this.#exitStatus !== null) return this.#exitStatus;
    const deadline = Date.now() + (opts?.timeout ?? this.timeouts.exit);
    for (;;) {
      if (this.#exitStatus !== null) return this.#exitStatus;
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          `the program was still running after ${opts?.timeout ?? this.timeouts.exit} ms`,
          this.errorDiagnostics({ suggestion: 'send signal("INT") or signal("TERM") before awaiting exit' }),
        );
      }
      await this.waitForChange(deadline);
    }
  }

  async waitForTitle(text: string | RegExp, opts?: WaitOptions): Promise<void> {
    const matcher = textMatcher(text, false);
    const deadline = Date.now() + (opts?.timeout ?? this.timeouts.text);
    for (;;) {
      const title = this.#vt.title;
      const hit =
        matcher.kind === 'regex'
          ? new RegExp(matcher.source.source, matcher.source.flags.replace('g', '')).test(title)
          : title.includes(matcher.text);
      if (hit) return;
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          `the window title never matched (last title: ${JSON.stringify(title)})`,
          this.errorDiagnostics(),
        );
      }
      this.#assertAlive('waitForTitle');
      await this.waitForChange(deadline);
    }
  }

  // -------------------------------------------------------------------------
  // LocatorContext

  settled(): Promise<void> {
    if (this.#settled) return Promise.resolve();
    return new Promise<void>((resolve) => this.#settleWaiters.push(resolve));
  }

  semanticIndex(): SemanticIndex | null {
    return this.#index;
  }

  semanticAttached(): boolean {
    return this.#attachment !== null;
  }

  semanticViolation(): ProtocolViolationError | null {
    return this.#violation;
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
    return this.#vt.modes();
  }

  waitForChange(deadline: number): Promise<void> {
    const remaining = Math.max(0, deadline - Date.now());
    return new Promise<void>((resolve) => {
      const waiter: ChangeWaiter = {
        resolve: () => {
          clearTimeout(waiter.timer);
          this.#changeWaiters.delete(waiter);
          resolve();
        },
        timer: setTimeout(() => {
          this.#changeWaiters.delete(waiter);
          resolve();
        }, remaining),
      };
      waiter.timer.unref?.();
      this.#changeWaiters.add(waiter);
    });
  }

  async sendInput(data: Uint8Array, kind: 'key' | 'mouse' | 'paste' | 'raw'): Promise<void> {
    this.assertOpen();
    if (this.#exitStatus !== null) {
      throw new ProcessExitedError(
        `cannot send input: the program exited with code ${String(this.#exitStatus.code)}`,
        this.errorDiagnostics(),
      );
    }
    this.#pty?.write(data);
    this.#emitter.emit('input', { data, timeMs: this.#now(), kind });
    await Promise.resolve();
  }

  /** Public, bounded diagnostics log (oldest first). */
  diagnostics(): readonly SessionDiagnostic[] {
    return Object.freeze([...this.#diagnosticsLog]);
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
      throw new SessionClosedError('the harness was closed', { semanticTree: false });
    }
  }

  // -------------------------------------------------------------------------
  // Teardown

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#negotiationTimer !== null) clearTimeout(this.#negotiationTimer);
    this.#settle();
    this.#pairing.dispose();
    // Releasing the pty hangs the terminal up, exactly like closing a terminal
    // window; no destructive signal is sent.
    this.#pty?.dispose();
    if (this.#exitStatus === null) {
      await Promise.race([this.exit, delay(CLOSE_GRACE_MS)]);
    }
    if (this.#exitStatus === null) this.#onExit({ code: null, signal: null });
    await this.#channel?.close();
    this.#vt.dispose();
    for (const waiter of [...this.#changeWaiters]) waiter.resolve();
    this.#emitter.clear();
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
  #diagnostic(code: DiagnosticCode, detail: string, revision?: number): void {
    const entry: SessionDiagnostic = {
      code,
      detail,
      ...(revision !== undefined ? { revision } : {}),
      timeMs: this.#now(),
    };
    this.#diagnosticsLog.push(Object.freeze(entry));
    if (this.#diagnosticsLog.length > MAX_DIAGNOSTICS) this.#diagnosticsLog.shift();
    this.#emitter.emit('diagnostic', entry);
  }

  #onAttach(attachment: SemanticAttachment): void {
    this.#attachment = attachment;
    this.#diagnostic(
      'adapter-attached',
      `adapter ${attachment.adapter.name}@${attachment.adapter.version} attached with capabilities [${attachment.capabilities.join(', ')}]`,
    );
    this.#pairing.setMarkerEnabled(attachment.markerEnabled);
    this.#settle();
  }

  #publishSemantic(snapshot: SemanticSnapshot): void {
    this.#index = new SemanticIndex(snapshot);
    this.#emitter.emit('semantic-revision', { revision: snapshot.revision, timeMs: this.#now() });
    this.#notifyChange();
  }

  #settle(): void {
    if (this.#settled) return;
    this.#settled = true;
    if (this.#negotiationTimer !== null) {
      clearTimeout(this.#negotiationTimer);
      this.#negotiationTimer = null;
    }
    const waiters = this.#settleWaiters;
    this.#settleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  #onExit(status: ExitStatus): void {
    if (this.#exitStatus !== null) return;
    this.#exitStatus = Object.freeze(status);
    this.#emitter.emit('exit', { ...status, timeMs: this.#now() });
    this.#resolveExit?.(this.#exitStatus);
    this.#settle();
    this.#notifyChange();
  }

  #assertAlive(operation: string): void {
    if (this.#exitStatus === null) return;
    throw new ProcessExitedError(
      `${operation} cannot make progress: the program exited with code ${String(this.#exitStatus.code)}` +
        (this.#exitStatus.signal === null ? '' : ` (signal ${this.#exitStatus.signal})`),
      this.errorDiagnostics(),
    );
  }

  #notifyChange(): void {
    for (const waiter of [...this.#changeWaiters]) waiter.resolve();
  }

  async #sendFocus(focused: boolean): Promise<void> {
    if (!this.modes().focusReporting) {
      throw new UnsupportedActionError(
        `the program has not enabled focus reporting, so ${focused ? 'focus' : 'blur'}() has nothing to deliver`,
        this.errorDiagnostics({ suggestion: 'the application under test must enable CSI ? 1004 h' }),
      );
    }
    await this.sendInput(encodeFocus(focused), 'raw');
  }

  #createScrollbackApi(): ScrollbackApi {
    const buffer = (): { baseY: number; viewportY: number; length: number } => {
      const active = this.#vt.terminal.buffer.active;
      return { baseY: active.baseY, viewportY: active.viewportY, length: active.length };
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
            session.errorDiagnostics({ suggestion: 'raise scrollbackLines when launching the session' }),
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
 * Variables a child genuinely needs to run under `envMode: 'replace'`.
 * Deliberately short: the tokens, cloud credentials and CI secrets sitting in a
 * test runner's environment are not the application under test's business.
 * Kept in sync with `@termwright/mcp`, which applies the same allowlist.
 */
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SHELL', 'TMPDIR', 'USER', 'TERM'] as const;

/** Builds the child environment; the handshake variables are added afterwards. */
function buildChildEnv(mode: EnvMode, overrides: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  if (mode === 'inherit') {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
  } else {
    for (const key of SAFE_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides ?? {})) env[key] = value;
  return env;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
