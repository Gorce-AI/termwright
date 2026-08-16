/**
 * Immutable, revision-stamped screen snapshots.
 *
 * Cells are materialized eagerly at capture time, so a snapshot keeps
 * describing the grid it was taken from even while the child keeps writing.
 * `ansi()` and `html()` delegate to addon-serialize, which can only serialize
 * the *live* emulator, so they throw {@link StaleSnapshotError} once the
 * emulator has moved past the snapshot's revision.
 */
import type { IBufferCell } from '@xterm/headless';
import { createLinkResolver, type CellLink } from '@termwright/vt';
import { DEFAULT_LIMITS, type CursorInfo } from '@termwright/protocol';
import type {
  CellAttributes,
  CellColor,
  CellSnapshot,
  ScreenSnapshot,
  TerminalModes,
} from './api.js';
import { StaleSnapshotError } from './errors.js';
import type { VtScreen } from './vt.js';

const EMPTY_CELL: CellSnapshot = Object.freeze({
  char: ' ',
  width: 1,
  fg: Object.freeze({ kind: 'default' }),
  bg: Object.freeze({ kind: 'default' }),
  attributes: Object.freeze({
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    strikethrough: false,
  }),
});

/** The blank cell used for out-of-range reads; shared and frozen. */
export function emptyCell(): CellSnapshot {
  return EMPTY_CELL;
}

function readColor(
  isDefault: boolean,
  isPalette: boolean,
  isRgb: boolean,
  value: number,
): CellColor {
  if (isRgb) {
    return Object.freeze({
      kind: 'rgb' as const,
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff,
    });
  }
  if (isPalette) return Object.freeze({ kind: 'palette' as const, index: value });
  void isDefault;
  return Object.freeze({ kind: 'default' as const });
}

function readAttributes(cell: IBufferCell): CellAttributes {
  return Object.freeze({
    bold: cell.isBold() !== 0,
    dim: cell.isDim() !== 0,
    italic: cell.isItalic() !== 0,
    underline: cell.isUnderline() !== 0,
    inverse: cell.isInverse() !== 0,
    strikethrough: cell.isStrikethrough() !== 0,
  });
}

/**
 * Ceiling on a hyperlink URI, borrowed from the protocol's string limit.
 *
 * A URI arrives from the program under test and is as long as that program
 * chose to make it — a `data:` URI has no practical bound. The cap is applied
 * with a flag rather than silently, because a truncated URI is a wrong URI,
 * and an assertion that compares against one deserves to know.
 */
const MAX_LINK_URI_BYTES = DEFAULT_LIMITS.maxStringBytes;

function readLink(link: CellLink | null): CellSnapshot['link'] {
  if (link === null) return undefined;
  const uri =
    link.uri.length > MAX_LINK_URI_BYTES ? link.uri.slice(0, MAX_LINK_URI_BYTES) : link.uri;
  return Object.freeze({
    uri,
    ...(link.id !== undefined ? { id: link.id } : {}),
    ...(uri.length < link.uri.length ? { truncated: true as const } : {}),
  });
}

function readCell(cell: IBufferCell, link: CellLink | null): CellSnapshot {
  const width = cell.getWidth();
  const resolved = readLink(link);
  return Object.freeze({
    char: cell.getChars(),
    width: (width === 0 || width === 2 ? width : 1) as 0 | 1 | 2,
    fg: readColor(cell.isFgDefault(), cell.isFgPalette(), cell.isFgRGB(), cell.getFgColor()),
    bg: readColor(cell.isBgDefault(), cell.isBgPalette(), cell.isBgRGB(), cell.getBgColor()),
    attributes: readAttributes(cell),
    ...(resolved !== undefined ? { link: resolved } : {}),
  });
}

/** Materialized grid: one row of cells plus its trimmed text. */
export interface CapturedRow {
  readonly cells: readonly CellSnapshot[];
  readonly text: string;
}

/** Reads the visible viewport of `vt` into plain frozen rows. */
export function captureRows(vt: VtScreen): readonly CapturedRow[] {
  const buffer = vt.terminal.buffer.active;
  const resolveLink = createLinkResolver(vt.terminal);
  const rows: CapturedRow[] = [];
  for (let y = 0; y < vt.rows; y += 1) {
    const line = buffer.getLine(buffer.viewportY + y);
    if (line === undefined) {
      rows.push(Object.freeze({ cells: Object.freeze([]), text: '' }));
      continue;
    }
    const cells: CellSnapshot[] = [];
    for (let x = 0; x < line.length; x += 1) {
      const cell = line.getCell(x);
      cells.push(cell === undefined ? EMPTY_CELL : readCell(cell, resolveLink(cell)));
    }
    rows.push(
      Object.freeze({
        cells: Object.freeze(cells),
        text: line.translateToString(true),
      }),
    );
  }
  return Object.freeze(rows);
}

/**
 * Captures an immutable {@link ScreenSnapshot} of the emulator's viewport.
 * The snapshot's revision is the emulator revision at capture time.
 */
export function captureScreen(vt: VtScreen): ScreenSnapshot {
  const revision = vt.revision;
  const rows = captureRows(vt);
  const columns = vt.columns;
  const rowCount = vt.rows;
  const cursor: CursorInfo = vt.cursor();
  const modes: TerminalModes = vt.modes();
  const buffer: 'normal' | 'alternate' = vt.terminal.buffer.active.type;

  const requireFresh = (api: string): void => {
    if (vt.revision !== revision) {
      throw new StaleSnapshotError(
        `screen().${api}() needs the live emulator, but the screen advanced from revision ${revision} to ${vt.revision}`,
        {
          semanticTree: false,
          suggestion: `call ${api}() on a freshly taken screen() snapshot, or await a wait helper first`,
        },
      );
    }
  };

  const snapshot: ScreenSnapshot = {
    revision,
    columns,
    rows: rowCount,
    buffer,
    cursor,
    modes,
    text(): string {
      return rows.map((row) => row.text).join('\n');
    },
    line(row: number): string {
      return rows[row]?.text ?? '';
    },
    cell(row: number, column: number): CellSnapshot {
      return rows[row]?.cells[column] ?? EMPTY_CELL;
    },
    ansi(): string {
      requireFresh('ansi');
      return vt.serializeAnsi(0);
    },
    html(): string {
      requireFresh('html');
      return vt.serializeHtml(0);
    },
  };
  return Object.freeze(snapshot);
}

/** Renders a bounded excerpt of the screen for error diagnostics. */
export function screenExcerpt(vt: VtScreen, maxRows = 12): string {
  const rows = captureRows(vt);
  const kept = rows.length <= maxRows ? rows : rows.slice(0, maxRows);
  const body = kept.map((row, index) => `${String(index).padStart(3, ' ')} | ${row.text}`);
  if (rows.length > kept.length) body.push(`    | … ${rows.length - kept.length} more rows`);
  return body.join('\n');
}
