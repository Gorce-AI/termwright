/**
 * VT layer: `@xterm/headless` 6.0 wrapped so the rest of the driver sees a
 * revision-stamped, promise-based emulator.
 *
 * Four verified constraints of the upstream package are handled here and
 * nowhere else:
 *
 * 1. the package is CJS-only despite shipping an `.mjs` build, so it must be
 *    imported through the default export (named ESM imports fail at runtime);
 * 2. `Terminal.write` is asynchronous — every write is awaited on its callback
 *    so revisions never race the parser;
 * 3. Unicode 11 width tables require explicit activation of the addon;
 * 4. `Terminal.modes` reports mouse *tracking* but not mouse *encoding*, and
 *    reports neither cursor visibility nor cursor shape, so a private
 *    `CSI ? h/l` handler tracks 1005/1006/1015/25 and `DECSCUSR` alongside it.
 *
 * The render-commit marker arrives as a private OSC sequence
 * (`ESC ] 8487 ; twm;{rev};{mac} BEL`) and is consumed here before it can reach
 * the grid. OSC was selected after the permeability probe in
 * `escapes.pty.test.ts` measured the legacy, frame-based inbox ConPTY dropping
 * DCS, APC and OSC 8 while passing private OSC. The pinned passthrough ConPTY
 * now forwards all of those families; OSC 8487 remains the one cross-platform
 * encoding certified end to end.
 */
import { createTerminal, loadSerializeAddon, type Terminal, type TerminalProfile } from '@termwright/vt';
import { MARKER_OSC_CODE, type CursorInfo } from '@termwright/protocol';
import type { TerminalModes } from './api.js';
import { captureRows } from './screen.js';

/**
 * What happened to a screen region between two revisions.
 *
 * `styling-changed` is separated from `glyphs-changed` because they answer
 * different questions. A pointer aims at characters; a repaint that recolours
 * them has not moved anything, while a character that changed may well have.
 */
export type RegionChange =
  | 'unchanged'
  | 'styling-changed'
  | 'glyphs-changed'
  | 'coordinate-system-moved'
  | 'span-out-of-range'
  | 'revision-unknown';

interface ObservableVtState {
  readonly structural: string;
  readonly cells: readonly string[];
  readonly columns: number;
  readonly rows: number;
  readonly buffer: 'normal' | 'alternate';
  readonly viewportY: number;
  readonly baseY: number;
  readonly retainedFloor: number;
  /**
   * Character and width per cell, without styling.
   *
   * A repaint that recolours a control leaves its characters where they were,
   * and a pointer aimed at those characters is still aimed at them. Tracked
   * apart so a restyle is not indistinguishable from a target that moved.
   */
  readonly glyphs: readonly string[];
}

type PendingObservationEvent =
  | { readonly kind: 'revision'; readonly revision: number }
  | { readonly kind: 'marker'; readonly payload: string; readonly screenRevision: number };


/** Options for {@link VtScreen}. */
export interface VtOptions {
  readonly columns: number;
  readonly rows: number;
  readonly scrollbackLines: number;
  /** Terminal profile; decides how characters are counted. */
  readonly profile?: TerminalProfile | string;
  /**
   * Whether the child's input-mode requests can be observed at all. Defaults
   * to true for certified PTY backends. Embeddings and synthetic backends may
   * explicitly set false when they cannot expose every relevant DECSET.
   *
   * This is a property of the transport, so it is not revised by what arrives:
   * a request that got through would only prove that *that* request got
   * through, and treating it as proof that the rest did would report a partial
   * view as a complete one — the exact mistake that makes a driver refuse a
   * click the child would have understood.
   */
  readonly modesObservable?: boolean;
}

type Unsubscribe = () => void;

interface MutableModes {
  /** Never `'unknown'`: this is what was observed, not what is reported. */
  mouseEncoding: Exclude<TerminalModes['mouseEncoding'], 'unknown'>;
  cursorVisible: boolean;
  cursorShape: CursorInfo['shape'] | undefined;
}

/**
 * Shell-integration state derived from OSC 133 prompt marks, the de-facto
 * standard (VS Code, iTerm2, WezTerm, kitty, fish, starship) for telling a
 * terminal where a prompt begins and when a command finished.
 */
export interface ShellIntegration {
  /** True once the program emitted any OSC 133 mark. */
  readonly supported: boolean;
  /**
   * True when the last mark says the shell is waiting for input: `B` (the
   * prompt has been printed and the input line is live) or `D` (the command
   * finished). `A` only announces that a prompt is *about to be drawn*, and
   * arrives before its text — treating it as readiness returns a screen that
   * has no prompt on it yet.
   */
  readonly ready: boolean;
  /** The last mark seen: `'A'` prompt, `'B'` input, `'C'` command, `'D'` done. */
  readonly lastMark: string | null;
  /** Exit status reported by an `OSC 133 ; D ; <code>` mark, when it carried one. */
  readonly lastExitCode: number | null;
  /** Working directory published through OSC 7, never parsed from prompt text. */
  readonly cwd: string | null;
  /** Number of BEL control characters observed since launch. */
  readonly bellCount: number;
}

/** A marker payload observed during a write, tagged with its revision. */
export interface MarkerSighting {
  /** Payload after `OSC 8487;`, e.g. `twm;7;AAAA…`. */
  readonly payload: string;
  /** Screen revision the marker commits, i.e. the revision of its write batch. */
  readonly screenRevision: number;
}

/** A reply generated by the terminal emulator, never by a user input device. */
export interface TerminalResponse {
  readonly data: string;
  readonly kind: 'emulator' | 'foreground-color' | 'background-color';
}

// A headless terminal has no host theme to query. Termwright therefore exposes
// one deterministic xterm-like theme to applications which use OSC 10/11 for
// startup detection. Four hex digits per component are required by the OSC
// colour-report grammar; these values match the VT's white-on-black model.
const FOREGROUND_RGB = 'rgb:ffff/ffff/ffff';
const BACKGROUND_RGB = 'rgb:0000/0000/0000';

/**
 * A headless terminal with a serialized write queue and a monotonically
 * increasing screen revision. One instance per session.
 */
export class VtScreen {
  readonly terminal: Terminal;
  /** The profile this emulator counts characters with. */
  readonly profile: TerminalProfile;

  #revision = 0;
  #queue: Promise<void> = Promise.resolve();
  #disposed = false;
  #scrollbackLines: number;
  #retainedFloor = 0;
  #modesObservable: boolean;
  #title = '';
  #modes: MutableModes = {
    mouseEncoding: 'default',
    cursorVisible: true,
    cursorShape: undefined,
  };
  #shell: { lastMark: string | null; lastExitCode: number | null; cwd: string | null; bellCount: number } = {
    lastMark: null,
    lastExitCode: null,
    cwd: null,
    bellCount: 0,
  };

  readonly #revisionListeners = new Set<(revision: number) => void>();
  readonly #markerListeners = new Set<(marker: MarkerSighting) => void>();
  readonly #titleListeners = new Set<(title: string) => void>();
  readonly #responseListeners = new Set<(response: TerminalResponse) => void>();
  readonly #pendingObservationEvents: PendingObservationEvent[] = [];
  #lastObservedState!: ObservableVtState;
  #cellLastChangedRevision: number[] = [];
  #cellLastGlyphRevision: number[] = [];
  #globalCoordinateRevision = 0;
  #pendingWriteCount = 0;
  #writeInProgress = false;
  #flushingObservationEvents = false;
  readonly #serialize: {
    serialize(options?: { scrollback?: number }): string;
    serializeAsHTML(options?: { scrollback?: number }): string;
  };

  constructor(options: VtOptions) {
    this.#scrollbackLines = options.scrollbackLines;
    // Every supported backend now preserves the child's mode changes. In
    // particular, the pinned passthrough ConPTY replaces the legacy inbox
    // renderer that consumed mouse/focus DECSET before it reached this VT.
    // `false` remains an explicit test/embedding capability declaration; the
    // host platform is no longer evidence that modes are hidden.
    this.#modesObservable = options.modesObservable ?? true;
    // The emulator is built by @termwright/vt, not here: a session, its replay
    // and a screenshot of that replay must count characters identically, and
    // they only do that if one factory builds all three.
    const built = createTerminal({
      columns: options.columns,
      rows: options.rows,
      scrollback: options.scrollbackLines,
      ...(options.profile !== undefined ? { profile: options.profile as never } : {}),
    });
    this.terminal = built.terminal;
    this.profile = built.profile;
    this.#serialize = loadSerializeAddon(this.terminal);

    this.#registerHandlers();
    this.#lastObservedState = this.#observableState();
    this.#cellLastChangedRevision = Array.from(
      { length: this.#lastObservedState.cells.length },
      () => this.#revision,
    );
    this.#cellLastGlyphRevision = [...this.#cellLastChangedRevision];
  }

  /** Current screen revision; incremented once per observable VT state change. */
  get revision(): number {
    return this.#revision;
  }

  /** True from enqueue until the callback of the final queued VT write. */
  get hasPendingWrite(): boolean {
    return this.#pendingWriteCount > 0;
  }

  /** Whether every VT write enqueued so far has reached its parse callback. */
  get isCaughtUp(): boolean {
    return this.#pendingWriteCount === 0;
  }

  /** Window title as last set by OSC 0/2. */
  get title(): string {
    return this.#title;
  }

  /** Number of scrollback lines evicted since the session started. */
  get retainedFloor(): number {
    return this.#retainedFloor;
  }

  get columns(): number {
    return this.terminal.cols;
  }

  get rows(): number {
    return this.terminal.rows;
  }

  /**
   * Feeds bytes to the emulator and resolves once they have been parsed and the
   * resulting revision published. Writes are serialized in call order.
   */
  write(data: Uint8Array | string): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#pendingWriteCount += 1;
    const run = this.#queue.then(
      () =>
        new Promise<void>((resolve) => {
          if (this.#disposed) {
            this.#pendingWriteCount -= 1;
            resolve();
            return;
          }
          this.#writeInProgress = true;
          this.terminal.write(data as string, () => {
            try {
              this.#commitObservableState();
              this.#writeInProgress = false;
              this.#flushObservationEvents();
            } finally {
              // Keep backlog true while observers process the completed write,
              // but never strand it if an observer unexpectedly throws.
              this.#writeInProgress = false;
              this.#pendingWriteCount -= 1;
              resolve();
            }
          });
        }),
    );
    this.#queue = run;
    return run;
  }

  /**
   * Resolves once every write issued so far has been parsed. A child's dying
   * output — a stack trace, a panic — is usually still in flight when the pty
   * reports the exit, so anything that reads the screen at that moment must
   * drain first or it reads a screen from before the crash.
   */
  drain(): Promise<void> {
    return this.#queue;
  }

  /** Every retained line, scrollback first, as text. */
  allLines(): string[] {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
    }
    return lines;
  }

  /** Resizes the emulator grid (the PTY is resized separately by the session). */
  resize(columns: number, rows: number): void {
    if (this.#disposed) return;
    this.terminal.resize(columns, rows);
    this.#commitObservableState();
    if (!this.#writeInProgress) this.#flushObservationEvents();
  }

  /**
   * Input-relevant modes, merged from `Terminal.modes` and our own tracking.
   *
   * Input modes read `'unknown'` only when an embedding explicitly declares
   * them unobservable. Reporting a definite value in that case would be a
   * claim the transport cannot support, so mode-gated actions fail closed.
   *
   * The pinned passthrough ConPTY carries the same DECSET stream as POSIX PTYs,
   * including mouse, focus, bracketed-paste and alternate-screen modes.
   */
  modes(): TerminalModes {
    const m = this.terminal.modes;
    const known = this.#modesObservable;
    return Object.freeze({
      mouseTracking: known ? m.mouseTrackingMode : ('unknown' as const),
      mouseEncoding: known ? this.#modes.mouseEncoding : ('unknown' as const),
      bracketedPaste: m.bracketedPasteMode,
      applicationCursorKeys: m.applicationCursorKeysMode,
      applicationKeypad: m.applicationKeypadMode,
      focusReporting: known ? (m.sendFocusMode ? ('on' as const) : ('off' as const)) : ('unknown' as const),
      synchronizedOutput: m.synchronizedOutputMode,
    });
  }

  /** Cursor position (viewport-relative), visibility and shape. */
  cursor(): CursorInfo {
    const buffer = this.terminal.buffer.active;
    return Object.freeze({
      row: buffer.cursorY,
      column: buffer.cursorX,
      visible: this.#modes.cursorVisible,
      ...(this.#modes.cursorShape !== undefined ? { shape: this.#modes.cursorShape } : {}),
    });
  }

  /** Which xterm buffer currently backs the visible viewport. */
  activeBuffer(): 'normal' | 'alternate' {
    return this.terminal.buffer.active === this.terminal.buffer.alternate ? 'alternate' : 'normal';
  }

  /** Prompt state as reported by OSC 133, if the program reports it at all. */
  shellIntegration(): ShellIntegration {
    return Object.freeze({
      supported: this.#shell.lastMark !== null,
      ready: this.#shell.lastMark === 'B' || this.#shell.lastMark === 'D',
      lastMark: this.#shell.lastMark,
      lastExitCode: this.#shell.lastExitCode,
      cwd: this.#shell.cwd,
      bellCount: this.#shell.bellCount,
    });
  }

  /** ANSI serialization of the visible grid (addon-serialize). */
  serializeAnsi(scrollback = 0): string {
    return this.#serialize.serialize({ scrollback });
  }

  /** HTML serialization of the visible grid (addon-serialize). */
  serializeHtml(scrollback = 0): string {
    return this.#serialize.serializeAsHTML({ scrollback });
  }

  onRevision(cb: (revision: number) => void): Unsubscribe {
    this.#revisionListeners.add(cb);
    return () => this.#revisionListeners.delete(cb);
  }

  /**
   * Whether every cell in `spans` survived unchanged since `revision`.
   * Returns false when a resize/buffer/scroll changed the coordinate system.
   * This is the target-local counterpart of global
   * waitForQuiet(): an unrelated status bar may animate without invalidating
   * a button elsewhere on screen.
   */
  regionUnchangedSince(
    revision: number,
    spans: readonly { readonly row: number; readonly from: number; readonly to: number }[],
  ): boolean {
    return this.regionChangeSince(revision, spans) === 'unchanged';
  }

  /**
   * Why a region is not usable at a past revision, or that it is.
   *
   * The three answers call for different work and are indistinguishable from
   * the boolean. A coordinate system that moved invalidates every region at
   * once and says nothing about the target; cells that changed say the target
   * itself is different; a span outside the grid is a caller error. A stale
   * pointer that reports only "changed" sends the reader looking in the wrong
   * place, which on Windows it has.
   */
  regionChangeSince(
    revision: number,
    spans: readonly { readonly row: number; readonly from: number; readonly to: number }[],
  ): RegionChange {
    if (revision < 0 || revision > this.#revision) return 'revision-unknown';
    if (revision < this.#globalCoordinateRevision) return 'coordinate-system-moved';
    const columns = this.terminal.cols;
    const rows = this.terminal.rows;
    let styled = false;
    for (const span of spans) {
      if (
        span.row < 0
        || span.row >= rows
        || span.from < 0
        || span.to < span.from
        || span.to > columns
      ) return 'span-out-of-range';
      for (let column = span.from; column < span.to; column += 1) {
        const index = span.row * columns + column;
        if ((this.#cellLastGlyphRevision[index] ?? this.#revision) > revision) return 'glyphs-changed';
        if ((this.#cellLastChangedRevision[index] ?? this.#revision) > revision) styled = true;
      }
    }
    return styled ? 'styling-changed' : 'unchanged';
  }

  onMarker(cb: (marker: MarkerSighting) => void): Unsubscribe {
    this.#markerListeners.add(cb);
    return () => this.#markerListeners.delete(cb);
  }

  onTitle(cb: (title: string) => void): Unsubscribe {
    this.#titleListeners.add(cb);
    return () => this.#titleListeners.delete(cb);
  }

  /** Receives terminal protocol replies which the session must return to the child. */
  onResponse(cb: (response: TerminalResponse) => void): Unsubscribe {
    this.#responseListeners.add(cb);
    return () => this.#responseListeners.delete(cb);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#revisionListeners.clear();
    this.#markerListeners.clear();
    this.#titleListeners.clear();
    this.#responseListeners.clear();
    this.terminal.dispose();
  }

  #registerHandlers(): void {
    const parser = this.terminal.parser;

    // xterm already implements authoritative VT replies such as DSR 6n from
    // its current cursor state. Headless users must forward onData themselves.
    this.terminal.onData((data) => this.#emitResponse({ data, kind: 'emulator' }));

    // @xterm/headless has no colour theme and consequently does not answer
    // OSC 10/11 queries. Supply Termwright's deterministic terminal policy.
    // Assignments (anything except exactly "?") remain owned by xterm.
    parser.registerOscHandler(10, (data: string) => {
      if (data !== '?') return false;
      this.#emitResponse({ data: `\x1b]10;${FOREGROUND_RGB}\x1b\\`, kind: 'foreground-color' });
      return true;
    });
    parser.registerOscHandler(11, (data: string) => {
      if (data !== '?') return false;
      this.#emitResponse({ data: `\x1b]11;${BACKGROUND_RGB}\x1b\\`, kind: 'background-color' });
      return true;
    });

    // Render-commit marker. An OSC handler receives everything after the
    // number and its separator, which is the payload verbatim.
    parser.registerOscHandler(MARKER_OSC_CODE, (data: string) => {
      // A marker is a logical observation boundary, independent of transport
      // chunking. Commit all bytes parsed before it now; bytes after the marker
      // will form a later revision in the write completion callback (or at the
      // next marker). Listener delivery remains deferred until parsing returns,
      // avoiding re-entrancy into xterm while preserving event order.
      this.#commitObservableState();
      this.#pendingObservationEvents.push({
        kind: 'marker',
        payload: data,
        screenRevision: this.#revision,
      });
      // Consumed: never reaches the grid.
      return true;
    });

    const setPrivateModes = (params: (number | number[])[], enabled: boolean): boolean => {
      for (const param of params) {
        const code = Array.isArray(param) ? param[0] : param;
        if (code === undefined) continue;
        this.#applyPrivateMode(code, enabled);
      }
      // Never handled exclusively: xterm still applies the modes it knows.
      return false;
    };
    parser.registerCsiHandler({ prefix: '?', final: 'h' }, (p) => setPrivateModes(p, true));
    parser.registerCsiHandler({ prefix: '?', final: 'l' }, (p) => setPrivateModes(p, false));

    // DECSCUSR — cursor shape, not exposed by `Terminal.modes`.
    parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, (p) => {
      const raw = p[0];
      const style = Array.isArray(raw) ? raw[0] : raw;
      this.#modes.cursorShape = cursorShapeFromDecscusr(style ?? 0);
      return false;
    });

    // OSC 133 — shell integration prompt marks. The payload is `A`, `B`, `C`
    // or `D`, optionally followed by `;`-separated arguments (`D;1` carries an
    // exit code). Not handled exclusively: the sequence has no visible effect.
    parser.registerOscHandler(133, (data: string) => {
      const mark = data[0];
      if (mark !== undefined && 'ABCD'.includes(mark)) {
        this.#shell.lastMark = mark;
        if (mark === 'D') {
          const argument = data.split(';')[1];
          const code = argument === undefined ? Number.NaN : Number(argument);
          this.#shell.lastExitCode = Number.isInteger(code) ? code : null;
        }
      }
      return false;
    });

    // OSC 7 — shell working directory as a file URL. Invalid or non-file
    // payloads remain unknown rather than being guessed from prompt text.
    parser.registerOscHandler(7, (data: string) => {
      try {
        const url = new URL(data);
        if (url.protocol === 'file:') this.#shell.cwd = decodeURIComponent(url.pathname);
      } catch {
        // Malformed application output is still passed to xterm; it simply
        // does not become a shell fact.
      }
      return false;
    });

    this.terminal.onBell(() => {
      this.#shell.bellCount += 1;
    });

    this.terminal.onTitleChange((title) => {
      this.#title = title;
      for (const cb of this.#titleListeners) cb(title);
    });

    this.terminal.onScroll(() => {
      const buffer = this.terminal.buffer.active;
      // Once the scrollback is saturated every scroll evicts its oldest line.
      if (buffer.baseY >= this.#scrollbackLines) this.#retainedFloor += 1;
    });
  }

  #emitResponse(response: TerminalResponse): void {
    for (const cb of this.#responseListeners) cb(response);
  }

  /**
   * Exact observable VT state used for screen revisions.
   *
   * PTY chunk boundaries are transport accidents (and differ substantially
   * under ConPTY), so they cannot define observation revisions. The serializer
   * captures cells, styles and cursor state; the remaining fields cover state
   * exposed independently by TerminalHarness.
   */
  #observableState(): ObservableVtState {
    const buffer = this.terminal.buffer.active;
    const cursor = this.cursor();
    const modes = this.modes();
    const captured = captureRows(this);
    const cells = captured.flatMap((row) => row.cells.map((cell) => JSON.stringify(cell)));
    // Tracked apart from the full cell. A repaint that restyles a control
    // leaves its characters exactly where they were, and a pointer aimed at
    // those characters is still aimed at them; a changed glyph is a different
    // matter. Collapsing the two makes every recolour look like the target
    // moved.
    const glyphs = captured.flatMap((row) => row.cells.map((cell) => `${cell.char}\u0000${cell.width}`));
    const structural = [
      this.terminal.cols,
      this.terminal.rows,
      this.activeBuffer(),
      buffer.baseY,
      buffer.viewportY,
      buffer.length,
      cursor.row,
      cursor.column,
      cursor.visible,
      cursor.shape ?? null,
      modes.mouseTracking,
      modes.mouseEncoding,
      modes.bracketedPaste,
      modes.applicationCursorKeys,
      modes.applicationKeypad,
      modes.focusReporting,
      modes.synchronizedOutput,
      this.#title,
      this.#shell.lastMark,
      this.#shell.lastExitCode,
      this.#shell.cwd,
      this.#shell.bellCount,
      this.#retainedFloor,
    ];
    return Object.freeze({
      structural: JSON.stringify(structural),
      cells: Object.freeze(cells),
      columns: this.terminal.cols,
      rows: this.terminal.rows,
      buffer: this.activeBuffer(),
      viewportY: buffer.viewportY,
      baseY: buffer.baseY,
      retainedFloor: this.#retainedFloor,
      glyphs: Object.freeze(glyphs),
    });
  }

  #commitObservableState(): void {
    const before = this.#lastObservedState;
    const after = this.#observableState();
    const changedCells: number[] = [];
    const count = Math.max(before.cells.length, after.cells.length);
    for (let index = 0; index < count; index += 1) {
      if (before.cells[index] !== after.cells[index]) changedCells.push(index);
    }
    if (before.structural === after.structural && changedCells.length === 0) return;

    this.#revision += 1;
    const global = before.columns !== after.columns
      || before.rows !== after.rows
      || before.buffer !== after.buffer
      || before.viewportY !== after.viewportY
      || before.baseY !== after.baseY
      || before.retainedFloor !== after.retainedFloor;
    if (global) {
      this.#globalCoordinateRevision = this.#revision;
      this.#cellLastChangedRevision = Array.from(
        { length: after.cells.length },
        () => this.#revision,
      );
      this.#cellLastGlyphRevision = [...this.#cellLastChangedRevision];
    } else {
      if (this.#cellLastChangedRevision.length !== after.cells.length) {
        // Defensive fail-closed fallback. A cell-count change should have been
        // classified as a coordinate-system change above.
        this.#globalCoordinateRevision = this.#revision;
        this.#cellLastChangedRevision = Array.from(
          { length: after.cells.length },
          () => this.#revision,
        );
        this.#cellLastGlyphRevision = [...this.#cellLastChangedRevision];
      } else {
        for (const index of changedCells) {
          this.#cellLastChangedRevision[index] = this.#revision;
          // Only when the character itself moved. Everything else about a cell
          // can change without the thing a pointer aims at having changed.
          if (before.glyphs[index] !== after.glyphs[index]) {
            this.#cellLastGlyphRevision[index] = this.#revision;
          }
        }
      }
    }
    this.#lastObservedState = after;
    this.#pendingObservationEvents.push({ kind: 'revision', revision: this.#revision });
  }

  #flushObservationEvents(): void {
    if (this.#flushingObservationEvents) return;
    this.#flushingObservationEvents = true;
    try {
      for (;;) {
        const event = this.#pendingObservationEvents.shift();
        if (event === undefined) return;
        if (event.kind === 'revision') {
          for (const cb of this.#revisionListeners) cb(event.revision);
        } else {
          const sighting: MarkerSighting = {
            payload: event.payload,
            screenRevision: event.screenRevision,
          };
          for (const cb of this.#markerListeners) cb(sighting);
        }
      }
    } finally {
      this.#flushingObservationEvents = false;
    }
  }

  #applyPrivateMode(code: number, enabled: boolean): void {
    switch (code) {
      case 25:
        this.#modes.cursorVisible = enabled;
        break;
      case 1005:
        this.#setEncoding('utf8', enabled);
        break;
      case 1006:
        this.#setEncoding('sgr', enabled);
        break;
      case 1015:
        this.#setEncoding('urxvt', enabled);
        break;
      default:
        break;
    }
  }

  #setEncoding(
    encoding: Exclude<TerminalModes['mouseEncoding'], 'default' | 'unknown'>,
    enabled: boolean,
  ): void {
    if (enabled) {
      this.#modes.mouseEncoding = encoding;
    } else if (this.#modes.mouseEncoding === encoding) {
      this.#modes.mouseEncoding = 'default';
    }
  }
}

function cursorShapeFromDecscusr(style: number): CursorInfo['shape'] | undefined {
  switch (style) {
    case 0:
    case 1:
    case 2:
      return 'block';
    case 3:
    case 4:
      return 'underline';
    case 5:
    case 6:
      return 'bar';
    default:
      return undefined;
  }
}
