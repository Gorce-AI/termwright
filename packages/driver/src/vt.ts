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
 * APC is not parsed by xterm.js, so the render-commit marker arrives as a
 * private DCS sequence (`ESC P twm;{rev};{mac} ST`) and is consumed here before
 * it can reach the grid.
 */
import xh from '@xterm/headless';
import serializeAddon from '@xterm/addon-serialize';
import unicode11Addon from '@xterm/addon-unicode11';
import type { ITerminalAddon, Terminal } from '@xterm/headless';
import { MARKER_DCS_FINAL, type CursorInfo } from '@termwright/protocol';
import type { TerminalModes } from './api.js';


/** Options for {@link VtScreen}. */
export interface VtOptions {
  readonly columns: number;
  readonly rows: number;
  readonly scrollbackLines: number;
}

type Unsubscribe = () => void;

interface MutableModes {
  mouseEncoding: TerminalModes['mouseEncoding'];
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
}

/** A DCS marker payload observed during a write, tagged with its revision. */
export interface MarkerSighting {
  /** Raw payload between DCS and ST, e.g. `twm;7;AAAA…`. */
  readonly payload: string;
  /** Screen revision the marker commits, i.e. the revision of its write batch. */
  readonly screenRevision: number;
}

/**
 * A headless terminal with a serialized write queue and a monotonically
 * increasing screen revision. One instance per session.
 */
export class VtScreen {
  readonly terminal: Terminal;

  #revision = 0;
  #queue: Promise<void> = Promise.resolve();
  #disposed = false;
  #scrollbackLines: number;
  #retainedFloor = 0;
  #title = '';
  #modes: MutableModes = {
    mouseEncoding: 'default',
    cursorVisible: true,
    cursorShape: undefined,
  };
  #shell: { lastMark: string | null; lastExitCode: number | null } = {
    lastMark: null,
    lastExitCode: null,
  };

  readonly #revisionListeners = new Set<(revision: number) => void>();
  readonly #markerListeners = new Set<(marker: MarkerSighting) => void>();
  readonly #titleListeners = new Set<(title: string) => void>();
  readonly #serialize: {
    serialize(options?: { scrollback?: number }): string;
    serializeAsHTML(options?: { scrollback?: number }): string;
  };

  constructor(options: VtOptions) {
    this.#scrollbackLines = options.scrollbackLines;
    this.terminal = new xh.Terminal({
      cols: options.columns,
      rows: options.rows,
      scrollback: options.scrollbackLines,
      allowProposedApi: true,
      convertEol: false,
    });

    const unicode = new unicode11Addon.Unicode11Addon();
    this.terminal.loadAddon(unicode as unknown as ITerminalAddon);
    // Explicit activation: loading the addon only registers the tables.
    this.terminal.unicode.activeVersion = '11';

    const serialize = new serializeAddon.SerializeAddon();
    this.terminal.loadAddon(serialize as unknown as ITerminalAddon);
    this.#serialize = serialize;

    this.#registerHandlers();
  }

  /** Current screen revision; incremented once per fully parsed write. */
  get revision(): number {
    return this.#revision;
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
    const run = this.#queue.then(
      () =>
        new Promise<void>((resolve) => {
          if (this.#disposed) {
            resolve();
            return;
          }
          this.terminal.write(data as string, () => {
            this.#revision += 1;
            for (const cb of this.#revisionListeners) cb(this.#revision);
            resolve();
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
  }

  /** Input-relevant modes, merged from `Terminal.modes` and our own tracking. */
  modes(): TerminalModes {
    const m = this.terminal.modes;
    return Object.freeze({
      mouseTracking: m.mouseTrackingMode,
      mouseEncoding: this.#modes.mouseEncoding,
      bracketedPaste: m.bracketedPasteMode,
      applicationCursorKeys: m.applicationCursorKeysMode,
      applicationKeypad: m.applicationKeypadMode,
      focusReporting: m.sendFocusMode,
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

  /** Prompt state as reported by OSC 133, if the program reports it at all. */
  shellIntegration(): ShellIntegration {
    return Object.freeze({
      supported: this.#shell.lastMark !== null,
      ready: this.#shell.lastMark === 'B' || this.#shell.lastMark === 'D',
      lastMark: this.#shell.lastMark,
      lastExitCode: this.#shell.lastExitCode,
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

  onMarker(cb: (marker: MarkerSighting) => void): Unsubscribe {
    this.#markerListeners.add(cb);
    return () => this.#markerListeners.delete(cb);
  }

  onTitle(cb: (title: string) => void): Unsubscribe {
    this.#titleListeners.add(cb);
    return () => this.#titleListeners.delete(cb);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#revisionListeners.clear();
    this.#markerListeners.clear();
    this.#titleListeners.clear();
    this.terminal.dispose();
  }

  #registerHandlers(): void {
    const parser = this.terminal.parser;

    // Render-commit marker. `ESC P twm;… ST` is parsed as DCS with final byte
    // 't' and payload 'wm;…', so the original payload is reassembled here.
    parser.registerDcsHandler({ final: MARKER_DCS_FINAL }, (data: string) => {
      const sighting: MarkerSighting = {
        payload: MARKER_DCS_FINAL + data,
        screenRevision: this.#revision + 1,
      };
      for (const cb of this.#markerListeners) cb(sighting);
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

  #setEncoding(encoding: Exclude<TerminalModes['mouseEncoding'], 'default'>, enabled: boolean): void {
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
