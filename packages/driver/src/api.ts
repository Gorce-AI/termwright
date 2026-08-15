/**
 * NORMATIVE public driver API. Every other package (test preset, MCP, UI,
 * ink-testing) programs against these types. Changes here require updating
 * CONTRACTS.md and notifying all package owners.
 */
import type {
  ProtocolErrorMessage,
  Rect,
  SemanticRole,
  SemanticSnapshot,
  SemanticState,
  CursorInfo,
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
 *   TMPDIR, USER, TERM) plus everything in {@link LaunchOptions.env};
 * - `'inherit'`: the parent's full environment, plus {@link LaunchOptions.env}.
 *
 * The termwright handshake variables are injected in both modes.
 */
export type EnvMode = 'inherit' | 'replace';

export interface LaunchOptions {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Defaults to `'replace'`: a test process's secrets are not the child's. */
  readonly envMode?: EnvMode;
  readonly columns?: number; // default 100
  readonly rows?: number; // default 30
  readonly semanticNegotiationMs?: number; // default 250
  readonly scrollbackLines?: number; // default 2_000
  readonly timeouts?: TimeoutClasses;
  readonly recording?: RecordingOptions;
}

export declare function launchTerminal(options: LaunchOptions): Promise<TerminalHarness>;

// ---------------------------------------------------------------------------
// Harness — the ONE interface shared by launchTerminal, mountInk and fixtures.

export interface TerminalHarness {
  readonly sessionId: string;

  capabilities(): SessionCapabilities;
  screen(): ScreenSnapshot;
  semanticTree(): SemanticSnapshot | null;
  cell(pos: { row: number; column: number }): CellSnapshot;

  // Locators (lazy handles, re-resolved per action)
  getByRole(role: SemanticRole, opts?: RoleLocatorOptions): Locator;
  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): Locator;
  getByText(text: string | RegExp, opts?: TextLocatorOptions): Locator;
  getByTestId(testId: string): Locator;
  /** Textual-style CSS dialect: 'dialog button.primary:focused', '#id'. */
  locator(selector: string): Locator;
  /**
   * Rebuilds a locator from a ref minted by {@link ResolvedTarget.ref}
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
  resize(size: { columns: number; rows: number }): Promise<void>;
  focus(): Promise<void>;
  blur(): Promise<void>;
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

  /** Idempotent; bounded physical cleanup. Never sends signals implicitly. */
  close(): Promise<void>;
  readonly exit: Promise<ExitStatus>;
}

export interface SessionCapabilities {
  readonly semanticTree: boolean;
  readonly adapter?: { readonly name: string; readonly version: string };
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
  readonly mouseTracking: 'none' | 'x10' | 'vt200' | 'drag' | 'any';
  readonly mouseEncoding: 'default' | 'sgr' | 'urxvt' | 'utf8';
  readonly bracketedPaste: boolean;
  readonly applicationCursorKeys: boolean;
  readonly applicationKeypad: boolean;
  readonly focusReporting: boolean;
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
}

export interface TextLocatorOptions {
  readonly exact?: boolean;
  readonly occurrence?: number;
  /** Style predicates for generic (non-semantic) matching. */
  readonly fg?: string;
  readonly bg?: string;
  readonly attributes?: Partial<CellAttributes>;
}

export interface WaitOptions {
  readonly timeout?: number;
}

export interface Locator {
  /** Human-readable form of the query, as it appears in error messages. */
  readonly description: string;

  within(parent: Locator): Locator;
  first(): Locator;
  nth(index: number): Locator;

  // Resolution (strict: 0 matches waits, >1 fails with candidates)
  resolve(opts?: WaitOptions): Promise<ResolvedTarget>;
  count(): Promise<number>;

  // Actions (through PTY; pre-flight: visible, enabled, in-viewport, mouse mode)
  click(opts?: PointerOptions): Promise<void>;
  doubleClick(opts?: PointerOptions): Promise<void>;
  dragTo(target: Locator, opts?: WaitOptions): Promise<void>;
  drag(opts: { from: { row: number; column: number }; to: { row: number; column: number } }): Promise<void>;
  wheel(opts: { deltaY: number; deltaX?: number }): Promise<void>;
  press(keys: string, opts?: WaitOptions): Promise<void>;
  type(text: string, opts?: WaitOptions): Promise<void>;
  focusNode(opts?: WaitOptions): Promise<void>;
  /** Documented physical strategy (click, or focus+Enter); receipt says which. */
  activate(opts?: WaitOptions): Promise<ActivateReceipt>;

  // State reads
  waitFor(opts?: { state?: 'visible' | 'hidden' | 'attached' } & WaitOptions): Promise<void>;
  isVisible(): Promise<boolean>;
  textContent(): Promise<string>;
  boundingBox(): Promise<Rect | null>;
  semanticState(): Promise<SemanticState | null>;
}

export interface PointerOptions extends WaitOptions {
  readonly button?: 'left' | 'middle' | 'right';
  readonly position?: { readonly rowOffset: number; readonly columnOffset: number };
}

export interface ResolvedTarget {
  /** 'n8@42' — node id at semantic revision, or a grid rect for generic matches. */
  readonly ref: string;
  readonly revision: number;
  readonly semantic: boolean;
  readonly rect: Rect | null;
  readonly role?: SemanticRole;
  readonly name?: string;
}

export interface ActivateReceipt {
  readonly strategy: 'click' | 'focus-enter' | 'focus-space';
  readonly ref: string;
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
  /** An advisory `revision-commit` arrived (pairing still needs the marker). */
  | 'revision-commit'
  /** An incomplete revision was dropped because a newer one was published. */
  | 'revision-superseded'
  /** Half a revision was dropped because its partner never arrived. */
  | 'revision-expired'
  /** A revision was dropped: already published, or too many were in flight. */
  | 'revision-dropped'
  /** A DCS marker arrived whose MAC did not verify; ordinary output cannot forge one. */
  | 'marker-unverified'
  /** The semantic channel was closed on a protocol violation. */
  | 'protocol-violation'
  /** The endpoint itself failed (listen/accept/write). */
  | 'endpoint-error'
  /** A `SessionEvents` listener threw; the session continued. */
  | 'listener-error'
  /** `waitForReady` observed an OSC 133 prompt mark: a fact, not a guess. */
  | 'ready-shell-integration'
  /** `waitForReady` fell back to "the screen settled": a heuristic. */
  | 'ready-settled-screen';

/** One entry of the session diagnostics log. */
export interface SessionDiagnostic {
  readonly code: DiagnosticCode;
  readonly detail: string;
  /** The semantic revision the entry is about, when it is about one. */
  readonly revision?: number;
  /**
   * For `protocol-violation`: the wire error code sent to the adapter, so a
   * caller can tell *which* failure closed the channel without parsing prose.
   */
  readonly wireCode?: ProtocolErrorMessage['code'];
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
}

// ---------------------------------------------------------------------------
// Typed errors — class names are normative; all extend TermwrightError.

export type TermwrightErrorCode =
  | 'timeout'
  | 'stale-snapshot'
  | 'ambiguous-locator'
  | 'unsupported-action'
  | 'history-truncated'
  | 'protocol-violation'
  | 'capacity'
  | 'process-exited'
  | 'session-closed';

export declare class TermwrightError extends Error {
  readonly code: TermwrightErrorCode;
  /** Last observed screen excerpt + bounded semantic candidates. */
  readonly diagnostics: ErrorDiagnostics;
}

export interface ErrorDiagnostics {
  readonly screenExcerpt?: string;
  readonly semanticTree: boolean;
  readonly candidates?: readonly ResolvedTarget[];
  readonly suggestion?: string;
}
