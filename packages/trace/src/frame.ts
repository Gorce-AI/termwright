/**
 * Reconstructing a screen from a recording.
 *
 * `stateAt()` hands back the raw output prefix; replaying it through the
 * headless emulator turns that back into a cell grid shaped like the driver's
 * `ScreenSnapshot`. That is what lets a screenshot, an MCP `frame_at` tool or
 * the runner UI show the screen as it stood at an arbitrary moment, long after
 * the session ended.
 */

import type { CellAttributes, CellColor, CellSnapshot } from '@termwright/driver';
import type { CursorInfo } from '@termwright/protocol';
import type { IBufferCell } from '@termwright/vt';
import type { TraceReader } from './reader.js';
import { createTerminal, writeToTerminal } from './vt.js';

/**
 * A screen reconstructed from a recording.
 *
 * Structurally a subset of the driver's `ScreenSnapshot`, so anything that
 * accepts a live screen — `@termwright/screenshot`, a YAML cell snapshot —
 * accepts this too. It carries no `revision`, `modes` or `buffer`: a recording
 * stores output, not emulator state.
 */
export interface TraceFrame {
  readonly columns: number;
  readonly rows: number;
  readonly cursor: CursorInfo;
  /** Cast-timeline offset this frame was reconstructed at, in milliseconds. */
  readonly timeMs: number;
  /** Semantic revision current at that offset, when the session had a tree. */
  readonly semanticRevision: number | null;
  cell(row: number, column: number): CellSnapshot;
  line(row: number): string;
  text(): string;
}

/** Options for {@link frameFromAnsi}. */
export interface FrameOptions {
  readonly columns?: number;
  readonly rows?: number;
  readonly timeMs?: number;
  readonly semanticRevision?: number | null;
  /**
   * Terminal profile to measure characters with. {@link frameAt} passes the
   * one the recording was made with; a mismatch moves wide characters by a
   * column without anything failing.
   */
  readonly profile?: string;
}

const EMPTY_CELL: CellSnapshot = {
  char: ' ',
  width: 1,
  fg: { kind: 'default' },
  bg: { kind: 'default' },
  attributes: {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    strikethrough: false,
  },
};

/**
 * Rebuilds the screen as it stood at `timeMs` on the cast timeline.
 *
 * @example
 * ```ts
 * const trace = await openTrace('out/login.twtrace');
 * const frame = await frameAt(trace, 1_500);
 * console.log(frame.text());
 * console.log(frame.semanticRevision);
 * await trace.close();
 * ```
 */
export async function frameAt(trace: TraceReader, timeMs: number): Promise<TraceFrame> {
  const state = await trace.stateAt(timeMs);
  return frameFromAnsi(state.castPrefix, {
    columns: state.columns,
    rows: state.rows,
    timeMs: state.timeMs,
    semanticRevision: state.nearestSemanticRevision,
    ...(trace.meta.terminalProfile === undefined
      ? {}
      : { profile: trace.meta.terminalProfile }),
  });
}

/** Replays an ANSI stream into a cell grid. */
export async function frameFromAnsi(
  ansi: string,
  options: FrameOptions = {},
): Promise<TraceFrame> {
  const columns = options.columns ?? 100;
  const rows = options.rows ?? 30;
  const terminal = createTerminal(columns, rows, options.profile);
  try {
    await writeToTerminal(terminal, ansi);
    const buffer = terminal.buffer.active;
    const grid: CellSnapshot[][] = [];
    const lines: string[] = [];
    for (let row = 0; row < rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row);
      if (line === undefined) {
        grid.push([]);
        lines.push('');
        continue;
      }
      const cells: CellSnapshot[] = [];
      for (let column = 0; column < columns; column += 1) {
        const cell = line.getCell(column);
        cells.push(cell === undefined ? EMPTY_CELL : toCellSnapshot(cell));
      }
      grid.push(cells);
      lines.push(line.translateToString(true));
    }
    const cursor: CursorInfo = {
      row: clamp(buffer.cursorY, 0, rows - 1),
      column: clamp(buffer.cursorX, 0, columns - 1),
      visible: true,
      shape: 'block',
    };

    return {
      columns,
      rows,
      cursor,
      timeMs: options.timeMs ?? 0,
      semanticRevision: options.semanticRevision ?? null,
      cell(row: number, column: number): CellSnapshot {
        return grid[row]?.[column] ?? EMPTY_CELL;
      },
      line(row: number): string {
        return lines[row] ?? '';
      },
      text(): string {
        return lines.join('\n');
      },
    };
  } finally {
    terminal.dispose();
  }
}

function toCellSnapshot(cell: IBufferCell): CellSnapshot {
  const width = cell.getWidth();
  const chars = cell.getChars();
  return {
    char: width === 0 ? '' : chars === '' ? ' ' : chars,
    width: width === 0 ? 0 : width === 2 ? 2 : 1,
    fg: colorOf(cell.isFgDefault(), cell.isFgPalette(), cell.getFgColor()),
    bg: colorOf(cell.isBgDefault(), cell.isBgPalette(), cell.getBgColor()),
    attributes: attributesOf(cell),
  };
}

function colorOf(isDefault: boolean, isPalette: boolean, value: number): CellColor {
  if (isDefault) return { kind: 'default' };
  if (isPalette) return { kind: 'palette', index: value & 0xff };
  return {
    kind: 'rgb',
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/**
 * xterm's attribute predicates return the attribute's bitmask, not a boolean —
 * `isBold()` yields `134217728` when set — so they are coerced rather than
 * compared.
 */
function attributesOf(cell: IBufferCell): CellAttributes {
  return {
    bold: Boolean(cell.isBold()),
    dim: Boolean(cell.isDim()),
    italic: Boolean(cell.isItalic()),
    underline: Boolean(cell.isUnderline()),
    inverse: Boolean(cell.isInverse()),
    strikethrough: Boolean(cell.isStrikethrough()),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
