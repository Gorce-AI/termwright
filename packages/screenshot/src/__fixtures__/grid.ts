/**
 * A hand-built cell grid, so the renderer's tests never depend on an emulator.
 * Not exported from `src/index.ts` — it never ships.
 */

import type { CellAttributes, CellColor, CellSnapshot } from '@termwright/driver';
import type { CursorInfo } from '@termwright/protocol';
import type { ScreenFrame } from '../types.js';

const NO_ATTRIBUTES: CellAttributes = {
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strikethrough: false,
};

const BLANK: CellSnapshot = {
  char: ' ',
  width: 1,
  fg: { kind: 'default' },
  bg: { kind: 'default' },
  attributes: NO_ATTRIBUTES,
};

/** Per-cell overrides accepted by {@link gridFrame}. */
export interface CellSpec {
  readonly char?: string;
  readonly width?: 0 | 1 | 2;
  readonly fg?: CellColor;
  readonly bg?: CellColor;
  readonly attributes?: Partial<CellAttributes>;
}

/** Builds a cell from a terse spec. */
export function cell(spec: CellSpec = {}): CellSnapshot {
  return {
    char: spec.char ?? ' ',
    width: spec.width ?? 1,
    fg: spec.fg ?? { kind: 'default' },
    bg: spec.bg ?? { kind: 'default' },
    attributes: { ...NO_ATTRIBUTES, ...spec.attributes },
  };
}

/**
 * Builds a frame from rows of cells. Short rows are padded with blanks.
 */
export function gridFrame(
  rows: readonly (readonly CellSnapshot[])[],
  options: { columns?: number; cursor?: CursorInfo } = {},
): ScreenFrame {
  const columns = options.columns ?? rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  return {
    columns,
    rows: rows.length,
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    cell(row: number, column: number): CellSnapshot {
      return rows[row]?.[column] ?? BLANK;
    },
  };
}

/** Builds a single-row frame from a string, one cell per code point. */
export function textFrame(
  text: string,
  options: { columns?: number; spec?: CellSpec; cursor?: CursorInfo } = {},
): ScreenFrame {
  const cells: CellSnapshot[] = [];
  for (const char of text) {
    cells.push(cell({ ...options.spec, char }));
  }
  return gridFrame([cells], {
    columns: options.columns ?? cells.length,
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
  });
}
