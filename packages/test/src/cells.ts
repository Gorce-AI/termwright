/**
 * Cell snapshots: a readable, framed rendering of the visible grid, optionally
 * with a legend of styled runs.
 *
 * Cell and semantic snapshots are deliberately separate oracles. A semantic
 * snapshot can pass while the screen is blank (the adapter publishes a tree
 * nobody painted); a cell snapshot cannot.
 */

import type { CellAttributes, CellColor, CellSnapshot, ScreenSnapshot } from '@termwright/driver';
import { ANSI_COLOR_NAMES, type ColorPalette } from './config.js';

/** Options for {@link serializeScreen}. */
export interface CellSnapshotOptions {
  /** Append the styled-run legend. Default false. */
  readonly attributes?: boolean;
  /** Draw the frame with the viewport size. Default true. */
  readonly box?: boolean;
  /** Drop empty rows at the bottom of the viewport. Default true. */
  readonly trimTrailingRows?: boolean;
  /** Names palette colors in the legend, so CI and laptop agree. */
  readonly palette?: ColorPalette;
}

const ATTRIBUTE_KEYS: readonly (keyof CellAttributes)[] = [
  'bold',
  'dim',
  'italic',
  'underline',
  'inverse',
  'strikethrough',
];

/**
 * Renders the visible grid.
 *
 * @example
 * ```
 * ┌─ 20×3 ─────────────┐
 * │Permission required │
 * │  [Approve]  Reject │
 * └────────────────────┘
 * ```
 */
export function serializeScreen(
  screen: Pick<ScreenSnapshot, 'columns' | 'rows' | 'cell'>,
  options: CellSnapshotOptions = {},
): string {
  const rows = readRows(screen);
  const visible = options.trimTrailingRows === false ? rows : trimTrailing(rows);
  const lines =
    options.box === false
      ? visible.map((row) => row.text)
      : frame(visible, screen.columns, screen.rows);
  if (options.attributes === true) {
    const legend = describeStyles(screen, options.palette);
    lines.push('attributes:', ...(legend.length === 0 ? ['  (none)'] : legend));
  }
  return `${lines.join('\n')}\n`;
}

interface Row {
  readonly text: string;
  /** Display width in cells, which differs from `text.length` for wide chars. */
  readonly width: number;
}

function readRows(screen: Pick<ScreenSnapshot, 'columns' | 'rows' | 'cell'>): readonly Row[] {
  const rows: Row[] = [];
  for (let row = 0; row < screen.rows; row += 1) {
    let text = '';
    let width = 0;
    for (let column = 0; column < screen.columns; column += 1) {
      const cell = screen.cell(row, column);
      if (cell.width === 0) continue; // continuation of the previous wide cell
      text += cell.char === '' ? ' ' : cell.char;
      width += cell.width;
    }
    const trimmed = text.replace(/ +$/u, '');
    rows.push({ text: trimmed, width: width - (text.length - trimmed.length) });
  }
  return rows;
}

function trimTrailing(rows: readonly Row[]): readonly Row[] {
  let end = rows.length;
  while (end > 0 && (rows[end - 1]?.text ?? '').length === 0) end -= 1;
  return rows.slice(0, end);
}

function frame(rows: readonly Row[], columns: number, viewportRows: number): string[] {
  const label = ` ${columns}×${viewportRows} `;
  const dashes = Math.max(columns - label.length - 1, 0);
  const lines = [`┌─${label}${'─'.repeat(dashes)}┐`];
  for (const row of rows) {
    lines.push(`│${row.text}${' '.repeat(Math.max(columns - row.width, 0))}│`);
  }
  lines.push(`└${'─'.repeat(columns)}┘`);
  return lines;
}

/** One line per run of identically styled, non-default cells. */
function describeStyles(
  screen: Pick<ScreenSnapshot, 'columns' | 'rows' | 'cell'>,
  palette: ColorPalette | undefined,
): string[] {
  const lines: string[] = [];
  for (let row = 0; row < screen.rows; row += 1) {
    let start = -1;
    let style = '';
    const flush = (end: number): void => {
      if (start === -1) return;
      const span = end - 1 === start ? `col ${start}` : `cols ${start}-${end - 1}`;
      lines.push(`  row ${row}, ${span}: ${style}`);
      start = -1;
    };
    for (let column = 0; column < screen.columns; column += 1) {
      const cell = screen.cell(row, column);
      const current = styleOf(cell, palette);
      if (current !== style) {
        flush(column);
        style = current;
        if (current !== '') start = column;
      }
    }
    flush(screen.columns);
  }
  return lines;
}

function styleOf(cell: CellSnapshot, palette: ColorPalette | undefined): string {
  const parts: string[] = ATTRIBUTE_KEYS.filter((key) => cell.attributes[key]);
  const fg = describeColor(cell.fg, palette);
  const bg = describeColor(cell.bg, palette);
  if (fg !== undefined) parts.push(`fg=${fg}`);
  if (bg !== undefined) parts.push(`bg=${bg}`);
  return parts.join(' ');
}

/** `undefined` for the terminal default, which is never worth a legend line. */
function describeColor(color: CellColor, palette: ColorPalette | undefined): string | undefined {
  if (color.kind === 'default') return undefined;
  if (color.kind === 'rgb') {
    return `#${[color.r, color.g, color.b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  }
  const name = ANSI_COLOR_NAMES[color.index];
  if (name === undefined) return `palette:${color.index}`;
  const hex = palette?.colors[color.index];
  return hex === undefined ? name : `${name}(${hex})`;
}
