/**
 * The terminal pane: an xterm.js instance fed by `output` messages, with an
 * overlay that draws semantic bounds on top of it.
 *
 * Bounds arrive in cell coordinates, so the overlay needs the pixel size of a
 * cell. It is derived from the rendered screen element rather than from xterm's
 * internals: `screen.clientWidth / cols` is exact for a monospaced grid and does
 * not depend on which renderer or which version is in use.
 *
 * **Character widths must match the driver's.** The driver measures with
 * Unicode 11 tables; xterm.js defaults to Unicode 6. Left alone, the same frame
 * can land a column apart between this pane and what the test saw — and nothing
 * errors, so the hunt starts in the application, where the bug is not. The
 * addon below closes that gap.
 */

import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import type { Rect } from '@termwright/protocol';

/** A highlight drawn over the grid. */
export interface Highlight {
  readonly rect: Rect;
  readonly label: string;
  readonly kind: 'hover' | 'selected';
}

/** Callbacks the pane reports back to the app. */
export interface TerminalPaneHandlers {
  /** Typed input, when the session accepts it. */
  onData?: (data: string) => void;
  /** A cell was clicked while pick mode was on. */
  onPick?: (position: { row: number; column: number }) => void;
  /** Pointer moved over a cell while pick mode was on. */
  onPickHover?: (position: { row: number; column: number } | null) => void;
}

/** Live terminal with a semantic overlay. */
export class TerminalPane {
  readonly #terminal: Terminal;
  readonly #fit = new FitAddon();
  readonly #overlay: HTMLDivElement;
  readonly #host: HTMLElement;
  #handlers: TerminalPaneHandlers = {};
  /**
   * True once a session or recording declared its viewport. From then on the
   * grid mirrors the session and the browser window does not get to reshape it:
   * a pane that reflows to its own size is showing a layout the program never
   * produced.
   */
  #pinned = false;
  #highlights: readonly Highlight[] = [];
  #picking = false;

  constructor(host: HTMLElement) {
    this.#host = host;
    this.#terminal = new Terminal({
      convertEol: false,
      cursorBlink: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      allowProposedApi: true,
      theme: { background: '#0e1117', foreground: '#e6e9ef' },
    });
    this.#terminal.loadAddon(this.#fit);
    // Registering the provider is not enough: xterm keeps using the active
    // version until it is switched, which was the second half of this trap.
    this.#terminal.loadAddon(new Unicode11Addon());
    this.#terminal.unicode.activeVersion = '11';
    this.#terminal.open(host);
    this.#fit.fit();

    this.#overlay = document.createElement('div');
    this.#overlay.className = 'overlay';
    host.append(this.#overlay);

    this.#terminal.onData((data) => this.#handlers.onData?.(data));
    this.#overlay.addEventListener('mousemove', (event) => {
      if (!this.#picking) return;
      this.#handlers.onPickHover?.(this.#cellAt(event));
    });
    this.#overlay.addEventListener('mouseleave', () => {
      if (this.#picking) this.#handlers.onPickHover?.(null);
    });
    this.#overlay.addEventListener('click', (event) => {
      if (!this.#picking) return;
      const cell = this.#cellAt(event);
      if (cell !== null) this.#handlers.onPick?.(cell);
    });
    new ResizeObserver(() => this.refit()).observe(host);
  }

  /** Registers the app's callbacks. */
  on(handlers: TerminalPaneHandlers): void {
    this.#handlers = handlers;
  }

  get columns(): number {
    return this.#terminal.cols;
  }

  get rows(): number {
    return this.#terminal.rows;
  }

  /** Writes terminal output. */
  write(data: string | Uint8Array): void {
    this.#terminal.write(data);
  }

  /** Clears the screen and its scrollback — used before replaying a prefix. */
  reset(): void {
    this.#terminal.reset();
    this.#terminal.clear();
  }

  /** Resizes the emulator to the session's viewport, and pins it there. */
  resize(columns: number, rows: number): void {
    this.#pinned = true;
    this.#terminal.resize(columns, rows);
    this.#drawOverlay();
  }

  /**
   * Refits the emulator to the pane — only while no session has declared a
   * viewport. Once one has, resizing the browser moves the overlay, not the
   * grid.
   */
  refit(): void {
    if (!this.#pinned) {
      try {
        this.#fit.fit();
      } catch {
        // The pane can be measured as zero-sized while the layout settles.
      }
    }
    this.#drawOverlay();
  }

  /** Pick mode: the overlay takes pointer events instead of the terminal. */
  setPicking(picking: boolean): void {
    this.#picking = picking;
    this.#overlay.classList.toggle('picking', picking);
  }

  /** Replaces the drawn highlights. */
  setHighlights(highlights: readonly Highlight[]): void {
    this.#highlights = highlights;
    this.#drawOverlay();
  }

  /** Unicode width tables the pane is measuring with. */
  get unicodeVersion(): string {
    return this.#terminal.unicode.activeVersion;
  }

  /** Focuses the emulator, so typing goes to the child. */
  focus(): void {
    this.#terminal.focus();
  }

  /** Pixel size of one cell, measured from the rendered grid. */
  #cellSize(): { width: number; height: number } | null {
    const screen = this.#host.querySelector<HTMLElement>('.xterm-screen');
    if (screen === null || this.#terminal.cols === 0 || this.#terminal.rows === 0) return null;
    const width = screen.clientWidth / this.#terminal.cols;
    const height = screen.clientHeight / this.#terminal.rows;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }

  #cellAt(event: MouseEvent): { row: number; column: number } | null {
    const size = this.#cellSize();
    const screen = this.#host.querySelector<HTMLElement>('.xterm-screen');
    if (size === null || screen === null) return null;
    const box = screen.getBoundingClientRect();
    const column = Math.floor((event.clientX - box.left) / size.width);
    const row = Math.floor((event.clientY - box.top) / size.height);
    if (row < 0 || column < 0 || row >= this.#terminal.rows || column >= this.#terminal.cols) return null;
    return { row, column };
  }

  #drawOverlay(): void {
    const size = this.#cellSize();
    const screen = this.#host.querySelector<HTMLElement>('.xterm-screen');
    this.#overlay.replaceChildren();
    if (size === null || screen === null) return;
    this.#overlay.style.left = `${screen.offsetLeft}px`;
    this.#overlay.style.top = `${screen.offsetTop}px`;
    this.#overlay.style.width = `${screen.clientWidth}px`;
    this.#overlay.style.height = `${screen.clientHeight}px`;

    for (const highlight of this.#highlights) {
      const box = document.createElement('div');
      box.className = `bounds ${highlight.kind}`;
      box.style.left = `${highlight.rect.column * size.width}px`;
      box.style.top = `${highlight.rect.row * size.height}px`;
      box.style.width = `${Math.max(highlight.rect.width, 1) * size.width}px`;
      box.style.height = `${Math.max(highlight.rect.height, 1) * size.height}px`;
      const label = document.createElement('span');
      label.className = 'bounds-label';
      label.textContent = highlight.label;
      box.append(label);
      this.#overlay.append(box);
    }
  }
}
