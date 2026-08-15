/**
 * Colour resolution: the 256-colour xterm palette and the default theme.
 *
 * The default theme deliberately matches the HTML failure report in
 * `@termwright/trace`, so a PNG thumbnail and the report's inline screen render
 * look like the same product rather than two unrelated colour schemes.
 */

import type { CellColor } from '@termwright/driver';
import type { ScreenshotTheme } from './types.js';

const ANSI_16: readonly string[] = [
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

/** termwright's dark theme; the same colours the HTML report uses. */
export const DEFAULT_THEME: ScreenshotTheme = {
  background: '#141414',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  ansi: ANSI_16,
};

/** A light theme, for documentation screenshots on a white page. */
export const LIGHT_THEME: ScreenshotTheme = {
  background: '#ffffff',
  foreground: '#24292f',
  cursor: '#24292f',
  ansi: [
    '#24292f',
    '#cf222e',
    '#116329',
    '#4d2d00',
    '#0969da',
    '#8250df',
    '#1b7c83',
    '#6e7781',
    '#57606a',
    '#a40e26',
    '#1a7f37',
    '#633c01',
    '#218bff',
    '#a475f9',
    '#3192aa',
    '#8c959f',
  ],
};

/** The full 256-entry xterm palette derived from a theme's 16 base colours. */
export function buildPalette(theme: ScreenshotTheme): readonly string[] {
  const colors: string[] = [];
  for (let index = 0; index < 16; index += 1) {
    colors.push(theme.ansi[index] ?? ANSI_16[index] ?? '#000000');
  }
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r += 1) {
    for (let g = 0; g < 6; g += 1) {
      for (let b = 0; b < 6; b += 1) {
        colors.push(hex(steps[r] ?? 0, steps[g] ?? 0, steps[b] ?? 0));
      }
    }
  }
  for (let index = 0; index < 24; index += 1) {
    const level = 8 + index * 10;
    colors.push(hex(level, level, level));
  }
  return colors;
}

/**
 * Resolves a driver {@link CellColor} to a CSS hex string.
 *
 * @param fallback - used for `{ kind: 'default' }`, i.e. the theme's foreground
 *   or background depending on which side of the cell is being resolved
 */
export function resolveColor(
  color: CellColor,
  palette: readonly string[],
  fallback: string,
): string {
  switch (color.kind) {
    case 'default':
      return fallback;
    case 'palette':
      return palette[color.index & 0xff] ?? fallback;
    case 'rgb':
      return hex(color.r & 0xff, color.g & 0xff, color.b & 0xff);
  }
}

function hex(r: number, g: number, b: number): string {
  const part = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}
