/**
 * ANSI → HTML rendering of a terminal screen, used by the failure report's
 * side-by-side visual diff.
 *
 * The design doc points at `@xterm/addon-serialize`'s `serializeAsHTML`, but
 * that addon can only serialize a whole buffer at once. A visual *diff* needs
 * per-row output so changed rows can be highlighted and aligned, so this module
 * drives `@xterm/headless` directly and walks the buffer cell by cell. It is
 * the same emulator the driver uses, so what the report shows is what the
 * session actually rendered.
 */

import type { IBufferCell } from '@xterm/headless';
import { createTerminal, writeToTerminal } from './vt.js';

/** Options for {@link renderAnsiToHtml}. */
export interface RenderOptions {
  readonly columns?: number;
  readonly rows?: number;
  /** Default foreground, used for cells with no explicit colour. */
  readonly foreground?: string;
  /** Default background of the rendered surface. */
  readonly background?: string;
}

/** One rendered screen row. */
export interface RenderedRow {
  /** Zero-based row index in the viewport. */
  readonly index: number;
  /** Plain text of the row, trailing whitespace trimmed. */
  readonly text: string;
  /** Inline-styled HTML of the row's cells (no wrapping element). */
  readonly html: string;
}

/** A fully rendered screen. */
export interface RenderedScreen {
  readonly columns: number;
  readonly rows: number;
  readonly lines: readonly RenderedRow[];
  /** Whole screen as one `<pre>`-ready HTML fragment. */
  readonly html: string;
  /** Whole screen as plain text. */
  readonly text: string;
}

const DEFAULT_FOREGROUND = '#d4d4d4';
const DEFAULT_BACKGROUND = '#141414';

/**
 * Renders an ANSI byte stream into styled HTML.
 *
 * @param ansi - raw terminal output, e.g. `TraceState.castPrefix` or
 *   `ScreenSnapshot.ansi()`
 *
 * @example
 * ```ts
 * const screen = await renderAnsiToHtml(state.castPrefix, { columns: 100, rows: 30 });
 * html += `<pre class="tw-screen">${screen.html}</pre>`;
 * ```
 */
export async function renderAnsiToHtml(
  ansi: string,
  options: RenderOptions = {},
): Promise<RenderedScreen> {
  const columns = options.columns ?? 100;
  const rows = options.rows ?? 30;
  const foreground = options.foreground ?? DEFAULT_FOREGROUND;
  const background = options.background ?? DEFAULT_BACKGROUND;

  const terminal = createTerminal(columns, rows);
  try {
    await writeToTerminal(terminal, ansi);
    const buffer = terminal.buffer.active;
    const lines: RenderedRow[] = [];
    for (let row = 0; row < rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row);
      if (line === undefined) {
        lines.push({ index: row, text: '', html: '' });
        continue;
      }
      lines.push({
        index: row,
        text: line.translateToString(true),
        html: renderLine(line, columns, foreground, background),
      });
    }
    return {
      columns,
      rows,
      lines,
      html: lines.map((line) => line.html).join('\n'),
      text: lines.map((line) => line.text).join('\n'),
    };
  } finally {
    terminal.dispose();
  }
}

/** Row indices whose text or styling differs between two rendered screens. */
export function changedRows(
  before: RenderedScreen,
  after: RenderedScreen,
): ReadonlySet<number> {
  const changed = new Set<number>();
  const count = Math.max(before.lines.length, after.lines.length);
  for (let row = 0; row < count; row += 1) {
    const a = before.lines[row];
    const b = after.lines[row];
    if (a?.html !== b?.html) changed.add(row);
  }
  return changed;
}

function write(terminal: TerminalType, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, resolve);
  });
}

interface CellStyle {
  readonly fg: string;
  readonly bg: string;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strikethrough: boolean;
}

function renderLine(
  line: { getCell(index: number, cell?: IBufferCell): IBufferCell | undefined },
  columns: number,
  foreground: string,
  background: string,
): string {
  let html = '';
  let pending = '';
  let pendingStyle: CellStyle | null = null;

  const flush = (): void => {
    if (pending === '' || pendingStyle === null) {
      pending = '';
      return;
    }
    html += wrap(pending, pendingStyle, foreground, background);
    pending = '';
  };

  for (let column = 0; column < columns; column += 1) {
    const cell = line.getCell(column);
    if (cell === undefined) break;
    if (cell.getWidth() === 0) continue; // wide-character continuation
    const style = styleOf(cell, foreground, background);
    if (pendingStyle === null || !sameStyle(pendingStyle, style)) {
      flush();
      pendingStyle = style;
    }
    const chars = cell.getChars();
    pending += chars === '' ? ' ' : chars;
  }
  flush();
  return html;
}

function styleOf(cell: IBufferCell, foreground: string, background: string): CellStyle {
  let fg = cell.isFgDefault() ? foreground : colorOf(cell.getFgColor(), cell.isFgRGB());
  let bg = cell.isBgDefault() ? background : colorOf(cell.getBgColor(), cell.isBgRGB());
  if (cell.isInverse()) {
    const swap = fg;
    fg = bg;
    bg = swap;
  }
  return {
    fg,
    bg,
    bold: cell.isBold() !== 0,
    dim: cell.isDim() !== 0,
    italic: cell.isItalic() !== 0,
    underline: cell.isUnderline() !== 0,
    strikethrough: cell.isStrikethrough() !== 0,
  };
}

function sameStyle(a: CellStyle, b: CellStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough
  );
}

function wrap(
  text: string,
  style: CellStyle,
  foreground: string,
  background: string,
): string {
  const declarations: string[] = [];
  if (style.fg !== foreground) declarations.push(`color:${style.fg}`);
  if (style.bg !== background) declarations.push(`background:${style.bg}`);
  if (style.bold) declarations.push('font-weight:700');
  if (style.dim) declarations.push('opacity:.6');
  if (style.italic) declarations.push('font-style:italic');
  const decoration: string[] = [];
  if (style.underline) decoration.push('underline');
  if (style.strikethrough) decoration.push('line-through');
  if (decoration.length > 0) declarations.push(`text-decoration:${decoration.join(' ')}`);

  const escaped = escapeHtml(text);
  if (declarations.length === 0) return escaped;
  return `<span style="${declarations.join(';')}">${escaped}</span>`;
}

/** Escapes text for use in HTML content. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function colorOf(value: number, isRgb: boolean): string {
  if (isRgb) return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
  return PALETTE[value & 0xff] ?? DEFAULT_FOREGROUND;
}

/** The standard xterm 256-colour palette as CSS hex strings. */
const PALETTE: readonly string[] = buildPalette();

function buildPalette(): readonly string[] {
  const base = [
    '#000000',
    '#cd3131',
    '#0dbc79',
    '#e5e510',
    '#2472c8',
    '#bc3fbc',
    '#11a8cd',
    '#e5e5e5',
    '#666666',
    '#f14c4c',
    '#23d18b',
    '#f5f543',
    '#3b8eea',
    '#d670d6',
    '#29b8db',
    '#f5f5f5',
  ];
  const colors = [...base];
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r += 1) {
    for (let g = 0; g < 6; g += 1) {
      for (let b = 0; b < 6; b += 1) {
        colors.push(hex(steps[r] ?? 0, steps[g] ?? 0, steps[b] ?? 0));
      }
    }
  }
  for (let i = 0; i < 24; i += 1) {
    const level = 8 + i * 10;
    colors.push(hex(level, level, level));
  }
  return colors;
}

function hex(r: number, g: number, b: number): string {
  const part = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}
