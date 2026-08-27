import { describe, expect, it } from 'vitest';
import { fakeScreen } from './__fixtures__/screen.js';
import { serializeScreen } from './cells.js';
import { XTERM_PALETTE } from './config.js';

describe('serializeScreen', () => {
  it('frames the grid and labels the viewport', () => {
    const screen = fakeScreen(['Permission required', '  [Approve]  Reject'], {
      columns: 20,
      rows: 3,
    });
    expect(serializeScreen(screen)).toBe(
      [
        '┌─ 20×3 ─────────────┐',
        '│Permission required │',
        '│  [Approve]  Reject │',
        '└────────────────────┘',
        '',
      ].join('\n'),
    );
  });

  it('drops trailing empty rows but keeps the viewport size in the label', () => {
    const screen = fakeScreen(['only'], { columns: 8, rows: 4 });
    expect(serializeScreen(screen)).toBe(['┌─ 8×4 ──┐', '│only    │', '└────────┘', ''].join('\n'));
  });

  it('keeps every row when asked', () => {
    const screen = fakeScreen(['a'], { columns: 3, rows: 3 });
    expect(serializeScreen(screen, { trimTrailingRows: false }).split('\n')).toHaveLength(6);
  });

  it('renders without a frame', () => {
    const screen = fakeScreen(['a', 'b'], { columns: 4, rows: 2 });
    expect(serializeScreen(screen, { box: false })).toBe('a\nb\n');
  });

  it('lists styled runs, naming palette colors', () => {
    const screen = fakeScreen(['ok fail'], {
      columns: 8,
      rows: 1,
      runs: [
        { row: 0, from: 3, to: 6, attributes: { bold: true }, fg: { kind: 'palette', index: 1 } },
      ],
    });
    const output = serializeScreen(screen, { attributes: true, palette: XTERM_PALETTE });
    expect(output).toContain('attributes:');
    expect(output).toContain('  row 0, cols 3-6: bold fg=red(#cd0000)');
  });

  it('reports rgb colors as hex and single cells without a range', () => {
    const screen = fakeScreen(['x'], {
      columns: 1,
      rows: 1,
      runs: [{ row: 0, from: 0, to: 0, bg: { kind: 'rgb', r: 0, g: 128, b: 255 } }],
    });
    expect(serializeScreen(screen, { attributes: true })).toContain('  row 0, col 0: bg=#0080ff');
  });

  it('says so when nothing is styled', () => {
    const screen = fakeScreen(['plain'], { columns: 5, rows: 1 });
    expect(serializeScreen(screen, { attributes: true })).toContain('  (none)');
  });
});
