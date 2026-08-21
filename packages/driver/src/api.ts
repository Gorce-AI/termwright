/**
 * NORMATIVE public driver API. Every other package (test preset, MCP, UI,
 * Ink component testing) programs against these types. Changes here require updating
 * CONTRACTS.md and notifying all package owners.
 */
import type {
  EffectiveSessionContract,
  ActionReceipt,
  ActionabilityExplanation,
  Condition,
  ConditionResult,
  LogRecord,
  ProbeInfo,
  ProtocolErrorMessage,
  ProvenanceSource,
  Rect,
  SemanticRole,
  SemanticSnapshot,
  SemanticExtendedState,
  SemanticState,
  CursorInfo,
  LocatorGeometry,
  LocatorVisibility,
  Observation,
  ObservationStamp,
  PointerHitTest,
  SpatialRelation,
  SessionCapabilityId,
} from '@termwright/protocol';

// ---------------------------------------------------------------------------
// Launch

export interface TimeoutClasses {
  readonly action?: number; // default 5_000
  readonly text?: number; // default 5_000
  readonly idle?: number; // default 2_000
  readonly ready?: number; // default 10_000
  readonly exit?: number; // default 10_000
}

export interface RecordingOptions {
  /** Recording of the raw session to asciicast is ON by default. */
  readonly enabled?: boolean;
  readonly idleTimeLimit?: number;
}

/**
 * How the child's environment is built.
 *
 * - `'replace'` (default, secret-safe): only a documented allowlist of
 *   variables the child genuinely needs (PATH, HOME, LANG, LC_ALL, SHELL,
 *   TMPDIR, USER on POSIX; the longer Windows list adds SystemRoot, PATHEXT
 *   and the profile variables) plus everything in {@link LaunchOptions.env};
 * - `'inherit'`: the parent's full environment, plus {@link LaunchOptions.env}.
 *
 * The termwright handshake variables are injected in both modes.
 *
 * `TERM` and `COLORTERM` are **set by the driver in both modes**, to
 * `xterm-256color` and `truecolor`, and are not inherited: the child's
 * terminal is this driver's emulator, whose capabilities are known exactly,
 * so passing on whatever terminal launched the test run would describe
 * something the child is not attached to — and passing on nothing (a Windows
 * runner has no `TERM` of its own) leaves ncurses-style libraries guessing.
 * An explicit entry in {@link LaunchOptions.env} still wins, for a caller
 * testing how their program behaves under a different `TERM`.
 */
export type EnvMode = 'inherit' | 'replace';

export interface LaunchOptions {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Defaults to `'replace'`: a test process's secrets are not the child's. */
  readonly envMode?: EnvMode;
  /**
   * Streams a live log of API calls, waits, revisions and diagnostics to
   * stderr. Also enabled by `TERMWRIGHT_DEBUG=1` (`=all` adds raw PTY traffic).
   */
  readonly debug?: boolean;
  /**
   * Log files to follow for the lifetime of the session. A file that does not
   * exist yet is waited for; one that already exists is followed from its
   * current end, so a session never replays a previous run.
   */
  readonly logs?: readonly AppLogSource[];
  /**
   * Terminal profile: which width tables and which of the switches terminals
   * disagree on this session uses. A built-in id (`'default'`, `'kitty'`,
   * `'iterm2-ambiguous-wide'`) or a profile object from `@termwright/vt`.
   *
   * It is recorded with the session so a replay, a screenshot and the runner
   * pane can count characters exactly as the live session did.
   */
  readonly terminalProfile?: string;
  readonly columns?: number; // default 100
  readonly rows?: number; // default 30
  readonly semanticNegotiationMs?: number; // default 2_000
  readonly scrollbackLines?: number; // default 2_000
  readonly timeouts?: TimeoutClasses;
  readonly recording?: RecordingOptions;
  /**
   * Termwright-managed modes instrument an interactive shell with exact
   * command markers. Test authors should normally use `terminal.openShell()`.
   */
  readonly shellIntegration?: 'external' | 'termwright-posix' | 'termwright-powershell';
  /**
   * Capabilities that must be present in the frozen session contract.
   * Launch waits for negotiation and throws `CapabilityUnavailableError`
   * before returning a harness when any requirement is missing.
   */
  readonly requiredCapabilities?: readonly SessionCapabilityId[];
}

export declare function launchTerminal(options: LaunchOptions): Promise<TerminalHarness>;

// ---------------------------------------------------------------------------
// Harness — the ONE interface shared by launchTerminal, mountInk and fixtures.

export interface TerminalHarness {
  readonly sessionId: string;
  /** Shell command boundaries and prompt state when the child emits OSC 133. */
  readonly shell: ShellApi;
  /** One physical keyboard implementation. Convenience methods delegate here. */
  readonly keyboard: Keyboard;
  /** One physical mouse implementation. Locator actions delegate here after planning. */
  readonly mouse: Mouse;
  /** Terminal-window focus reports, distinct from semantic element focus. */
  readonly window: TerminalWindow;
  /** Emulator facts captured together at the current screen revision. */
  readonly terminalState: TerminalState;

  capabilities(): SessionCapabilities;
  /** Frozen negotiated contract, or null until negotiation has completed. */
  contract(): EffectiveSessionContract | null;
  /** Atomic identity of the currently committed terminal/semantic observation. */
  checkpoint(): ObservationStamp;
  /** Wait until a committed observation newer than `after` is available. */
  waitForCheckpointChange(options: { readonly after: ObservationStamp } & WaitOptions): Promise<ObservationStamp>;
  /**
   * The capabilities, once they are final.
   *
   * `capabilities()` answers immediately with what is known so far, which is
   * what a synchronous caller needs. This waits for the negotiation to reach
   * its verdict and, for a semantic session, for the first tree to be published. After it resolves,
   * `semanticTree` will not change again.
   */
  settled(opts?: WaitOptions): Promise<EffectiveSessionContract>;
  screen(): ScreenSnapshot;
  semanticTree(): SemanticSnapshot | null;
  cell(pos: { row: number; column: number }): CellSnapshot;

  // Locators (lazy handles, re-resolved per action)
  getByRole(role: SemanticRole, opts?: RoleLocatorOptions): Locator;
  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): Locator;
  /** Semantic text only. Never falls back to the terminal grid. */
  getByText(text: string | RegExp, opts?: TextLocatorOptions): Locator;
  /** Physical terminal-grid text, optionally narrowed by occurrence or style. */
  getByScreenText(text: string | RegExp, opts?: ScreenTextLocatorOptions): Locator;
  getByTestId(testId: string): Locator;
  /** Advanced Termwright semantic selector: 'dialog button.primary:focused', '#id'. */
  locator(selector: string): Locator;
  /**
   * Rebuilds a locator from a ref returned by a resolved target.
   * (`'n8@42'` for a semantic node, `'grid:r,c,w,h@7'` for a grid match).
   * The ref stays bound to its revision: resolving it after that revision was
   * superseded raises `stale-snapshot`.
   */
  locatorForRef(ref: string): Locator;

  // Raw input (always through the PTY)
  press(keys: string): Promise<void>; // 'Control+A', 'Escape', 'Enter'
  type(text: string): Promise<void>;
  paste(text: string): Promise<void>;
  write(bytes: Uint8Array | string): Promise<void>; // raw, no newline
  resize(size: { columns: number; rows: number }): Promise<ResizeReceipt>;
  signal(sig: 'INT' | 'TERM' | 'KILL' | 'HUP'): Promise<void>;

  // Waits (revision/event based; never sleeps)
  waitForText(text: string | RegExp, opts?: WaitOptions): Promise<void>;
  waitForRender(opts: { after: number } & WaitOptions): Promise<void>;
  waitForStable(opts?: { frames?: number } & WaitOptions): Promise<void>;
  waitForIdle(opts?: WaitOptions): Promise<void>;
  /**
   * Waits until the program is ready for input: shell-integration prompt
   * marks (OSC 133) when the program emits them, otherwise a settled-screen
   * heuristic. Which one was used is reported as a `diagnostic` event.
   */
  waitForReady(opts?: WaitOptions): Promise<void>;
  waitForExit(opts?: WaitOptions): Promise<ExitStatus>;
  title(): string;
  waitForTitle(text: string | RegExp, opts?: WaitOptions): Promise<void>;

  // Emulator-side (no child input)
  readonly scrollback: ScrollbackApi;
  readonly selection: SelectionApi;

  // Recording / trace hooks (consumed by @termwright/trace and @termwright/ui)
  readonly events: SessionEvents;

  /**
   * Bounded, oldest-first log of what the session decided behind the scenes:
   * dropped or superseded revisions, unverified markers, adapter negotiation,
   * protocol violations. The same entries are emitted as `diagnostic` events.
   */
  diagnostics(): readonly SessionDiagnostic[];

  /**
   * Bounded, oldest-first application-log history, including entries emitted
   * while `launchTerminal()` was still starting. Consumers should subscribe to
   * `app-log` first and then seed from this snapshot to avoid a startup gap.
   */
  appLogs(): readonly AppLogEvent[];

  /**
   * What the session knew when the program died unexpectedly, or `null` — for a
   * live session, a clean exit, or one the harness asked for via `close()` or
   * `signal()`. Available as soon as the `exit` event fires.
   */
  crashReport(): CrashReport | null;

  /** Idempotent; bounded physical cleanup. Never sends signals implicitly. */
  close(): Promise<void>;
  readonly exit: Promise<ExitStatus>;
}

export interface Keyboard {
  press(keys: string): Promise<void>;
  type(text: string): Promise<void>;
  paste(text: string): Promise<void>;
}

export interface MousePoint {
  readonly row: number;
  readonly column: number;
}

export type MouseModifier = 'shift' | 'alt' | 'control';

export interface MouseModifierOptions {
  readonly modifiers?: readonly MouseModifier[];
}

export interface Mouse {
  move(point: MousePoint & MouseModifierOptions): Promise<void>;
  down(point: MousePoint & MouseModifierOptions & { readonly button?: 'left' | 'middle' | 'right' }): Promise<void>;
  up(point: MousePoint & MouseModifierOptions & { readonly button?: 'left' | 'middle' | 'right' }): Promise<void>;
  click(point: MousePoint & MouseModifierOptions & { readonly button?: 'left' | 'middle' | 'right'; readonly clickCount?: 1 | 2 }): Promise<void>;
  wheel(options: MousePoint & MouseModifierOptions & { readonly deltaY?: number; readonly deltaX?: number }): Promise<void>;
  drag(options: MouseModifierOptions & { readonly from: MousePoint; readonly to: MousePoint; readonly steps?: number; readonly path?: readonly MousePoint[] }): Promise<void>;
}

export interface TerminalWindow {
  focus(): Promise<void>;
  blur(): Promise<void>;
}

/** One authoritative snapshot of terminal-emulator state. */
export interface TerminalStateSnapshot {
  readonly screenRevision: number;
  readonly dimensions: { readonly columns: number; readonly rows: number };
  readonly buffer: 'normal' | 'alternate';
  readonly title: string;
  readonly cursor: CursorInfo;
  readonly bellCount: number;
  readonly modes: TerminalModes;
}

/** Coherent terminal state for tests and diagnostics. */
export interface TerminalState {
  snapshot(): TerminalStateSnapshot;
}

/** Observable shell-integration state; fields are never inferred from prompt text. */
export interface ShellStatus {
  readonly supported: boolean;
  readonly ready: boolean;
  readonly lastMark: 'A' | 'B' | 'C' | 'D' | null;
  readonly lastExitCode: number | null;
  /** Last OSC 7 working directory, or null when the child never published one. */
  readonly cwd: string | null;
  readonly title: string;
  readonly cursor: CursorInfo;
  readonly bellCount: number;
}

export interface ShellRunOptions extends WaitOptions {
  /** Maximum captured bytes between OSC 133 C and D. Defaults to 8 MiB. */
  readonly maxOutputBytes?: number;
}

/** One command, bounded by the shell's OSC 133 C and D marks. */
export interface ShellCommandResult {
  readonly command: string;
  /** Exact terminal bytes emitted between command-start and command-end marks. */
  readonly output: string;
  readonly exitCode: number | null;
  readonly cwd: string | null;
  readonly title: string;
  /** The exact physical keyboard plan that submitted this command. */
  readonly receipt: ActionReceipt;
}

export interface ShellApi {
  status(): ShellStatus;
  waitForPrompt(options?: WaitOptions): Promise<void>;
  run(command: string, options?: ShellRunOptions): Promise<ShellCommandResult>;
}

export interface SessionCapabilities {
  readonly semanticTree: boolean;
  /** Id of the terminal profile this session counts characters with. */
  readonly terminalProfile: string;
  readonly adapter?: { readonly name: string; readonly version: string };
  /** Self-description supplied by an instrumented framework probe. */
  readonly probe?: ProbeInfo;
  readonly capabilities: readonly string[];
  readonly platform: NodeJS.Platform;
}

export interface ExitStatus {
  readonly code: number | null;
  readonly signal: string | null;
}

// ---------------------------------------------------------------------------
// Screen model

export interface CellSnapshot {
  readonly char: string; // grapheme cluster ('' for wide-char continuation)
  readonly width: 0 | 1 | 2;
  readonly fg: CellColor;
  readonly bg: CellColor;
  readonly attributes: CellAttributes;
  /** The OSC 8 hyperlink covering this cell, when it has one. */
  readonly link?: CellLink;
}

/**
 * A hyperlink attached to a cell.
 *
 * `id` is the OSC 8 `id=` parameter. It is the only parameter that survives:
 * the sequence permits `key=value:key=value`, and the emulator keeps `id` and
 * discards the rest — so anything carrying data through a hyperlink has this
 * one field to carry it in.
 */
export interface CellLink {
  readonly uri: string;
  readonly id?: string;
  /**
   * True when `uri` was cut to the string ceiling and is therefore **not** the
   * address the program wrote. Present only when it happened, so an assertion
   * against a URI can tell "this is the link" from "this is the front of it".
   */
  readonly truncated?: true;
}

export type CellColor =
  | { readonly kind: 'default' }
  | { readonly kind: 'palette'; readonly index: number }
  | { readonly kind: 'rgb'; readonly r: number; readonly g: number; readonly b: number };

export interface CellAttributes {
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
  readonly strikethrough: boolean;
}

export interface TerminalModes {
  /**
   * Mouse tracking level the child asked for, or `'unknown'`.
   *
   * `'none'` means observed off — the child enabled nothing. `'unknown'` means
   * the platform makes the mode unobservable: ConPTY is an emulator, so it
   * consumes the child's `CSI ? 1000/1002/1006 h` instead of forwarding it, and
   * the driver never learns what was asked for. The distinction is load-bearing
   * for pointer actions: `'none'` is authoritatively off, while `'unknown'`
   * means Termwright cannot select a protocol without guessing. Both fail
   * before input is written, with distinct diagnostics.
   */
  readonly mouseTracking: 'none' | 'x10' | 'vt200' | 'drag' | 'any' | 'unknown';
  /**
   * Mouse report encoding, or `'unknown'` when the platform hides it (see
   * {@link TerminalModes.mouseTracking}). Pointer actions fail closed under
   * `'unknown'`; Termwright never guesses SGR.
   */
  readonly mouseEncoding: 'default' | 'sgr' | 'urxvt' | 'utf8' | 'unknown';
  readonly bracketedPaste: boolean;
  readonly applicationCursorKeys: boolean;
  readonly applicationKeypad: boolean;
  /**
   * Whether the child asked for focus in/out reports, or `'unknown'`.
   *
   * `'unknown'` means the reading is the host's state and says nothing about
   * the child — which covers both ways the value gets falsified: a request the
   * terminal swallowed, and a state the terminal added on its own. ConPTY does
   * the second: it reports focus reporting as enabled for a child that never
   * asked, so a driver that believes it sends `CSI I` to a program that will
   * print it.
   */
  readonly focusReporting: 'on' | 'off' | 'unknown';
  readonly synchronizedOutput: boolean;
}

export interface ScreenSnapshot {
  readonly revision: number;
  readonly columns: number;
  readonly rows: number;
  readonly buffer: 'normal' | 'alternate';
  readonly cursor: CursorInfo;
  readonly modes: TerminalModes;
  /** Visible grid text, one string per row (trailing whitespace trimmed). */
  text(): string;
  line(row: number): string;
  cell(row: number, column: number): CellSnapshot;
  /** ANSI-styled serialization of the visible grid (addon-serialize). */
  ansi(): string;
  html(): string;
}

export interface ScrollbackApi {
  readonly length: number;
  readonly retainedFloor: number;
  move(opts: { lines: number }): void;
  position(): number;
  text(opts?: { from?: number; to?: number }): string;
  search(text: string | RegExp): readonly { line: number; match: string }[];
}

export interface SelectionApi {
  selectCells(range: { start: { row: number; column: number }; end: { row: number; column: number } }): void;
  copy(): string;
  clear(): void;
}

// ---------------------------------------------------------------------------
// Locators

export interface RoleLocatorOptions {
  readonly name?: string | RegExp;
  readonly exact?: boolean;
  readonly state?: Partial<SemanticState>;
  /**
   * Narrows to nodes whose framework type matches, e.g.
   * `getByRole('generic', { frameworkType: 'ScrollView' })`.
   *
   * Without it `generic` is barely selectable: every widget a recognizer did
   * not know arrives under that one role, and the role alone cannot tell them
   * apart.
   */
  readonly frameworkType?: string | RegExp;
}

export interface TextLocatorOptions {
  readonly exact?: boolean;
}

export interface ScreenTextLocatorOptions extends TextLocatorOptions {
  readonly occurrence?: number;
  /** Style predicates evaluated against terminal cells. */
  readonly fg?: string;
  readonly bg?: string;
  readonly attributes?: Partial<CellAttributes>;
}

export interface WaitOptions {
  readonly timeout?: number;
}

export interface LocatorDragOptions extends WaitOptions, MouseModifierOptions {
  /** Number of interpolated pointer moves. Defaults to the cell distance. */
  readonly steps?: number;
  /** Explicit viewport-cell path. The resolved destination is appended. */
  readonly path?: readonly MousePoint[];
}

export interface LocatorWheelOptions extends WaitOptions, MouseModifierOptions {
  readonly position?: { readonly rowOffset: number; readonly columnOffset: number };
  readonly deltaY?: number;
  readonly deltaX?: number;
}

export interface Locator {
  /** Human-readable form of the query, as it appears in error messages. */
  readonly description: string;

  within(parent: Locator): Locator;
  /** Natural descendant query scoped to this locator. */
  getByRole(role: SemanticRole, opts?: RoleLocatorOptions): Locator;
  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): Locator;
  getByText(text: string | RegExp, opts?: TextLocatorOptions): Locator;
  getByScreenText(text: string | RegExp, opts?: ScreenTextLocatorOptions): Locator;
  getByTestId(testId: string): Locator;
  locator(selector: string): Locator;
  first(): Locator;
  last(): Locator;
  nth(index: number): Locator;
  filter(options: LocatorFilterOptions): Locator;
  and(other: Locator): Locator;
  or(other: Locator): Locator;

  // Resolution (strict: 0 matches waits, >1 fails with candidates)
  resolve(opts?: WaitOptions): Promise<ResolvedTarget>;
  count(): Promise<number>;

  // Actions (through PTY; pre-flight: visible, enabled, in-viewport, mouse mode)
  click(opts?: PointerOptions): Promise<ActionReceipt>;
  doubleClick(opts?: PointerOptions): Promise<ActionReceipt>;
  hover(opts?: PointerOptions): Promise<ActionReceipt>;
  actionability(
    action: 'click' | 'double-click' | 'hover' | 'focus' | 'activate' | 'press' | 'type' | 'fill' | 'check' | 'uncheck',
    opts?: PointerOptions & { readonly value?: string },
  ): Promise<ActionabilityExplanation>;
  dragTo(target: Locator, opts?: LocatorDragOptions): Promise<ActionReceipt>;
  wheel(opts: LocatorWheelOptions): Promise<ActionReceipt>;
  press(keys: string, opts?: WaitOptions): Promise<ActionReceipt>;
  type(text: string, opts?: WaitOptions): Promise<ActionReceipt>;
  fill(text: string, opts?: WaitOptions): Promise<ActionReceipt>;
  focus(opts?: WaitOptions): Promise<ActionReceipt>;
  /** Physical activation through the same planned device path as click and keyboard input. */
  activate(opts?: WaitOptions): Promise<ActionReceipt>;
  check(opts?: WaitOptions): Promise<ActionReceipt>;
  uncheck(opts?: WaitOptions): Promise<ActionReceipt>;

  // State reads
  waitFor(opts?: { state?: 'visible' | 'hidden' | 'attached' | 'detached' | 'displayed' | 'offscreen' | 'focused' | 'enabled' | 'disabled' | 'checked' | 'selected' | 'expanded' | 'collapsed' } & WaitOptions): Promise<void>;
  /** Evaluate the same canonical condition model used by waits and ActionPlanner. */
  evaluateCondition(condition: Condition): Promise<ConditionResult>;
  /** Atomic, evidence-qualified geometry. Never invents a rectangle. */
  geometry(): Promise<LocatorGeometry>;
  /** Attached/displayed/viewport facts without collapsing unknown to false. */
  visibility(): Promise<LocatorVisibility>;
  /** Whether pointer input at the chosen cell reaches this exact target. */
  hitTest(opts?: { readonly position?: PointerOptions['position'] }): Promise<PointerHitTest>;
  /** Atomic cells inside this locator's qualified rectangle. */
  cellSnapshot(opts?: LocatorCellSnapshotOptions): Promise<LocatorCellSnapshot>;
  textContent(): Promise<string>;
  /** Published semantic value, distinct from the accessible name/text. */
  semanticValue(): Promise<string | null>;
  semanticState(): Promise<SemanticState | null>;
  /** Application-defined state, separate from portable semantic flags. */
  extendedState(): Promise<SemanticExtendedState | null>;
}

export interface LocatorFilterOptions {
  readonly hasText?: string | RegExp;
  readonly has?: Locator;
  readonly hasNot?: Locator;
}

export interface LocatorCellSnapshotOptions {
  readonly box?: 'visible' | 'intended';
  readonly padding?: number | { readonly top?: number; readonly right?: number; readonly bottom?: number; readonly left?: number };
}

export interface LocatorCellSnapshot {
  readonly stamp: ObservationStamp;
  readonly origin: { readonly row: number; readonly column: number };
  readonly columns: number;
  readonly rows: number;
  text(): string;
  line(row: number): string;
  cell(row: number, column: number): CellSnapshot;
}

export interface ResizeReceipt {
  readonly requested: { readonly columns: number; readonly rows: number };
  readonly before: ObservationStamp;
  readonly after: ObservationStamp;
  /** Revision that proves the child repainted at the new PTY size. */
  readonly pairedRender: Observation<number>;
}

export interface BoundsExpectation {
  readonly row?: number;
  readonly column?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface SpatialRelationExpectation {
  readonly relation: SpatialRelation;
  readonly target: Locator;
}

export interface PointerOptions extends WaitOptions, MouseModifierOptions {
  readonly button?: 'left' | 'middle' | 'right';
  readonly position?: { readonly rowOffset: number; readonly columnOffset: number };
}

export interface ResolvedTarget {
  /** 'n8@42' — node id at semantic revision, or a grid rect for generic matches. */
  readonly ref: string;
  readonly revision: number;
  readonly semantic: boolean;
  /**
   * Rectangle used by the resolution/action pipeline. A semantic target only
   * exposes an evidence-qualified visible rectangle here; intended geometry is
   * never promoted to pointer ownership. Use {@link Locator.geometry},
   * {@link Locator.visibility}, or {@link Locator.hitTest} for assertions.
   */
  readonly rect: Rect | null;
  readonly role?: SemanticRole;
  readonly name?: string;
  /**
   * Whether a resolved target's `ref` means anything after this revision.
   *
   * `'stable'` — the identity survives across frames, so the ref can be
   * re-resolved later and `locatorForRef` works. `'frame-local'` — the id is
   * an index into one frame and means nothing in the next; a probe for a
   * framework with no stable identity (Ratatui) says so at handshake time.
   *
   * Re-resolving a frame-local ref would not answer "did this node change?"
   * but "what holds that number now?", which is how a passing test ends up
   * asserting about a widget it never selected.
   */
  readonly identity: 'stable' | 'frame-local';
  /**
   * The framework's own name for the widget, when the node carries one.
   *
   * Required on `generic` nodes by the protocol, and the reason a `generic`
   * node is worth having: without it an unrecognised widget says only
   * "something was here".
   */
  readonly frameworkType?: string;
  /** Where this node's facts came from, when the producer reported it. */
  readonly provenance?: ProvenanceSource;
  /**
   * Whether the producer could tell what covers these cells.
   *
   * `'known'` — paint order was observable, so {@link ResolvedTarget.rect} is
   * geometry the user can actually reach. Anything else, absence included,
   * means the rectangle is where the widget asked to draw and something may
   * be on top of it. Pointer actions refuse on anything but `'known'`.
   */
  readonly occlusion?: 'known' | 'unknown';
}

// ---------------------------------------------------------------------------
// Events (trace/UI backbone)

export interface SessionEvents {
  on<E extends keyof SessionEventMap>(event: E, cb: (payload: SessionEventMap[E]) => void): () => void;
}

/**
 * Closed set of session diagnostic codes. Adding a code is a contract change:
 * conformance suites assert on them.
 */
export type DiagnosticCode =
  /** No adapter completed the handshake within the negotiation window. */
  | 'negotiation-timeout'
  /** An adapter completed the handshake. */
  | 'adapter-attached'
  /** The adapter's connection went away. */
  | 'adapter-disconnected'
  /** The adapter cannot do something the driver would have used. */
  | 'adapter-capability'
  /** A committed observation violated a capability frozen at negotiation. */
  | 'adapter-guarantee-violation'
  | 'duplicate-semantic-key'
  /** An advisory `revision-commit` arrived (pairing still needs the marker). */
  | 'revision-commit'
  /** An incomplete revision was dropped because a newer one was published. */
  | 'revision-superseded'
  /** Half a revision was dropped because its partner never arrived. */
  | 'revision-expired'
  /** A revision was dropped: already published, or too many were in flight. */
  | 'revision-dropped'
  /** A render marker arrived whose MAC did not verify; ordinary output cannot forge one. */
  | 'marker-unverified'
  /** The semantic channel was closed on a protocol violation. */
  | 'protocol-violation'
  /** The endpoint itself failed (listen/accept/write). */
  | 'endpoint-error'
  /** A `SessionEvents` listener threw; the session continued. */
  | 'listener-error'
  /** Lines the driver did not deliver: a log source outran its rate limit. */
  | 'log-dropped'
  /** A followed log source changed state: attached, rotated, truncated, unreadable. */
  | 'log-source'
  /** `waitForReady` observed an OSC 133 prompt mark: a fact, not a guess. */
  | 'ready-shell-integration'
  /** `waitForReady` fell back to "the screen settled": a heuristic. */
  | 'ready-settled-screen'
  /** The terminal emulator answered an application query through PTY stdin. */
  | 'terminal-response'
  /**
   * Input was sent while the mode governing it was unverifiable — recorded
   * once per session and mode, since it describes the platform rather than the
   * action. {@link SessionDiagnostic.mode} says which mode.
   */
  | 'mode-unverifiable';

/** A log file the session follows. */
export interface AppLogSource {
  readonly path: string;
  /** Short name used in events and diagnostics; defaults to the path. */
  readonly label?: string;
}

/**
 * One entry of an application's own log, published on the session timeline.
 *
 * Two sources feed this event and they carry different payloads: a followed
 * file yields {@link line}, an instrumented adapter yields a structured
 * {@link record}. Exactly one of them is present.
 */
export interface AppLogEvent {
  readonly source: 'file' | 'adapter';
  readonly label?: string;
  /**
   * Path of the followed file, for `source: 'file'`. A label can be short and
   * shared between sources; the path is what a reader opens.
   */
  readonly path?: string;
  /** Raw line, for a followed file. Truncated lines end with an ellipsis. */
  readonly line?: string;
  /** Structured record, for an adapter that negotiated the logs capability. */
  readonly record?: LogRecord;
  /**
   * Milliseconds since session start, on the same clock as every other event.
   *
   * For a file this is when the driver *read* the line, not when the program
   * wrote it: the two differ by up to one poll interval, so treat it as an
   * upper bound rather than as the write timestamp. A record carries the
   * adapter's own timestamp inside it.
   */
  readonly timeMs: number;
}

/** One remembered input, as it appears in a {@link CrashReport}. */
export interface CrashInput {
  readonly timeMs: number;
  readonly kind: 'key' | 'mouse' | 'paste' | 'raw';
  readonly bytes: number;
  /**
   * Escaped, truncated preview of what was sent. Omitted for pastes, which
   * routinely carry secrets — their size is reported instead.
   */
  readonly preview?: string;
}

/**
 * What the session knew at the moment a program died unexpectedly.
 *
 * "Unexpectedly" means the child exited on a signal, or with a non-zero code,
 * without the harness being asked for it: neither `close()` nor an explicit
 * `signal()` produces a report.
 */
export interface CrashReport {
  readonly exit: ExitStatus;
  /**
   * Last lines of scrollback plus the visible grid, oldest first, with trailing
   * blank lines trimmed — where a stack trace or a panic message ends up.
   *
   * This is what the terminal showed, verbatim and unscrubbed: whatever the
   * program (or the tty's echo) displayed is here, secrets included. Treat a
   * crash report like a screenshot when storing or forwarding it.
   */
  readonly screenTail: readonly string[];
  /** Last fully paired semantic revision, when the session had one. */
  readonly lastSemanticTree: SemanticSnapshot | null;
  /** The most recent inputs, oldest first — what was sent just before the end. */
  readonly recentInputs: readonly CrashInput[];
  /** Tail of the session diagnostics log. */
  readonly diagnosticsTail: readonly SessionDiagnostic[];
  /** Milliseconds since session start, on the same clock as every event. */
  readonly timeMs: number;
}

/**
 * One action the harness or a locator performed, reported after it finished —
 * successfully or not.
 *
 * This is what turns a recording into a story: the raw stream shows bytes going
 * into the terminal, while these events say which call sent them, at what, and
 * whether it worked.
 */
export interface ActionEvent {
  /** Correlates this completion with the preceding {@link ActionStartedEvent}. */
  readonly actionId: string;
  /** Method that ran, e.g. `'click'`, `'press'`, `'resize'`. */
  readonly api: string;
  /** The locator's description, for actions that had one. */
  readonly selector?: string;
  /** Ref of the target the action resolved, when it resolved one. */
  readonly ref?: string;
  readonly ok: boolean;
  /**
   * Failure reason: the {@link TermwrightErrorCode} when the action failed with
   * a driver error, otherwise the error's name. Never the full message — the
   * message belongs to the thrown error, this field is for grouping.
   */
  readonly error?: string;
  /** Exact failed planner evaluation, bound to the checkpoint that rejected the action. */
  readonly actionability?: ActionabilityExplanation;
  /** Atomic screen/tree identity at completion; trace consumers must not guess. */
  readonly observation?: ObservationStamp;
  /**
   * The exact plan and physical operations executed for a successful semantic
   * action. This is the same receipt returned to the caller, not a diagnostic
   * reconstruction performed after the action.
   */
  readonly receipt?: ActionReceipt;
  readonly timeMs: number;
}

/**
 * An action that has begun but has not settled yet.
 *
 * Consumers use this lifecycle edge for an honest live progress indicator.
 * The eventual {@link ActionEvent} with the same `actionId` remains the
 * authoritative outcome.
 */
export interface ActionStartedEvent {
  readonly actionId: string;
  /** Method that began, e.g. `'click'`, `'press'`, `'resize'`. */
  readonly api: string;
  /** Locator description when the action was initiated through a locator. */
  readonly selector?: string;
  readonly timeMs: number;
}

/** One entry of the session diagnostics log. */
export interface SessionDiagnostic {
  readonly code: DiagnosticCode;
  readonly detail: string;
  /** The semantic revision the entry is about, when it is about one. */
  readonly revision?: number;
  /**
   * How many items the entry accounts for, when it stands for several — the
   * number that would otherwise be readable only by parsing {@link detail}.
   *
   * Present on aggregate entries: records an adapter dropped upstream, records
   * or lines the driver refused over budget. Absent when the entry is about one
   * identified thing (a single revision, a single refused duplicate), because
   * there is nothing to count there. Summing `count` over `log-dropped`
   * entries therefore answers "how many log entries never reached me".
   */
  readonly count?: number;
  /**
   * For `protocol-violation`: the wire error code sent to the adapter, so a
   * caller can tell *which* failure closed the channel without parsing prose.
   */
  readonly wireCode?: ProtocolErrorMessage['code'];
  /**
   * For `mode-unverifiable`: which mode could not be verified. A field rather
   * than a code per mode, so a consumer reacting to "the driver is working
   * blind" writes one branch instead of a list that grows with the platform.
   */
  readonly mode?: 'mouse' | 'focus';
  readonly timeMs: number;
}

export interface SessionEventMap {
  output: { readonly data: Uint8Array; readonly timeMs: number };
  diagnostic: SessionDiagnostic;
  input: { readonly data: Uint8Array; readonly timeMs: number; readonly kind: 'key' | 'mouse' | 'paste' | 'raw' };
  resize: { readonly columns: number; readonly rows: number; readonly timeMs: number };
  'screen-revision': { readonly revision: number; readonly timeMs: number };
  'semantic-revision': { readonly revision: number; readonly timeMs: number };
  exit: ExitStatus & { readonly timeMs: number };
  /** A line or record from the application own log. */
  'app-log': AppLogEvent;
  /** One harness or locator action, reported after it finished. */
  action: ActionEvent;
  /** One harness or locator action, reported immediately before it begins. */
  'action-start': ActionStartedEvent;
  /**
   * The child died unexpectedly. Emitted before `exit`, so a listener reacting
   * to the exit can already read {@link TerminalHarness.crashReport}.
   */
  crash: CrashReport;
}

// ---------------------------------------------------------------------------
// Typed errors — class names are normative; all extend TermwrightError.

export type TermwrightErrorCode =
  | 'timeout'
  | 'stale-snapshot'
  | 'ambiguous-locator'
  | 'semantic-capability-unavailable'
  | 'probe-attach-failed'
  | 'capability-unavailable'
  | 'not-actionable'
  | 'input-mode-disabled'
  | 'capability-provider-lost'
  | 'capability-provider-violation'
  | 'adapter-guarantee-violation'
  | 'duplicate-semantic-key'
  | 'history-truncated'
  | 'protocol-violation'
  | 'capacity'
  | 'process-exited'
  | 'session-closed'
  /**
   * A named resource does not exist: an archive file, a working directory, a
   * path that was supposed to hold something. Distinct from
   * `protocol-violation`, which means a resource exists and is malformed —
   * a missing file breaks no format, and telling the two apart is what lets a
   * CLI answer "you pointed at nothing" instead of "your data is corrupt".
   */
  | 'not-found';

export declare class TermwrightError extends Error {
  readonly code: TermwrightErrorCode;
  /** Last observed screen excerpt + bounded semantic candidates. */
  readonly diagnostics: ErrorDiagnostics;
  /** Exact failed planner evaluation when this error originated in ActionPlanner. */
  readonly actionability?: ActionabilityExplanation;
}

export interface ErrorDiagnostics {
  readonly screenExcerpt?: string;
  readonly semanticTree: boolean;
  readonly candidates?: readonly ResolvedTarget[];
  readonly suggestion?: string;
}
