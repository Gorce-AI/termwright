/** A `ScreenSnapshot` built from plain strings, for tests that need no PTY. */

import type { CellAttributes, CellColor, CellSnapshot, ScreenSnapshot } from '@termwright/driver';

const NO_ATTRIBUTES: CellAttributes = Object.freeze({
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strikethrough: false,
});

const DEFAULT_COLOR: CellColor = Object.freeze({ kind: 'default' });

/** Styling applied to a rectangular run of one row. */
export interface StyledRun {
  readonly row: number;
  readonly from: number;
  readonly to: number;
  readonly attributes?: Partial<CellAttributes>;
  readonly fg?: CellColor;
  readonly bg?: CellColor;
}

export interface FakeScreenOptions {
  readonly columns?: number;
  readonly rows?: number;
  readonly runs?: readonly StyledRun[];
}

/** Builds a screen whose rows are `lines`, padded to the viewport size. */
export function fakeScreen(lines: readonly string[], options: FakeScreenOptions = {}): ScreenSnapshot {
  const columns = options.columns ?? Math.max(...lines.map((line) => [...line].length), 1);
  const rows = options.rows ?? lines.length;
  const grid = Array.from({ length: rows }, (_, row) => [...(lines[row] ?? '')]);
  const runs = options.runs ?? [];

  const cell = (row: number, column: number): CellSnapshot => {
    const char = grid[row]?.[column] ?? ' ';
    const run = runs.find((entry) => entry.row === row && column >= entry.from && column <= entry.to);
    return {
      char,
      width: 1,
      fg: run?.fg ?? DEFAULT_COLOR,
      bg: run?.bg ?? DEFAULT_COLOR,
      attributes: { ...NO_ATTRIBUTES, ...(run?.attributes ?? {}) },
    };
  };

  const line = (row: number): string => (grid[row] ?? []).join('').replace(/ +$/u, '');

  return {
    revision: 1,
    columns,
    rows,
    buffer: 'normal',
    cursor: { row: 0, column: 0, visible: true },
    modes: {
      mouseTracking: 'none',
      mouseEncoding: 'default',
      bracketedPaste: false,
      applicationCursorKeys: false,
      applicationKeypad: false,
      focusReporting: 'off',
      synchronizedOutput: false,
    },
    text: () => Array.from({ length: rows }, (_, row) => line(row)).join('\n'),
    line,
    cell,
    ansi: () => Array.from({ length: rows }, (_, row) => line(row)).join('\r\n'),
    html: () => '',
  };
}
