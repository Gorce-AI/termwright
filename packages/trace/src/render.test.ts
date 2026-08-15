import { describe, expect, it } from 'vitest';
import { changedRows, escapeHtml, renderAnsiToHtml } from './render.js';

const ESC = '\u001b';

describe('renderAnsiToHtml', () => {
  it('renders plain text without any markup', async () => {
    const screen = await renderAnsiToHtml('hello', { columns: 10, rows: 2 });
    expect(screen.lines[0]?.html).toBe('hello     ');
    expect(screen.lines[0]?.text).toBe('hello');
    expect(screen.text.split('\n')).toHaveLength(2);
  });

  it('turns SGR colours into inline styles', async () => {
    const screen = await renderAnsiToHtml(`${ESC}[31mred${ESC}[0m`, { columns: 5, rows: 1 });
    expect(screen.lines[0]?.html).toContain('color:#cd3131');
    expect(screen.lines[0]?.html).toContain('>red<');
  });

  it('renders 24-bit colour', async () => {
    const screen = await renderAnsiToHtml(`${ESC}[38;2;18;52;86mx`, { columns: 3, rows: 1 });
    expect(screen.lines[0]?.html).toContain('color:#123456');
  });

  it('renders bold, italic and underline attributes', async () => {
    const screen = await renderAnsiToHtml(
      `${ESC}[1mB${ESC}[0m${ESC}[3mI${ESC}[0m${ESC}[4mU`,
      { columns: 5, rows: 1 },
    );
    const html = screen.lines[0]?.html ?? '';
    expect(html).toContain('font-weight:700');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('text-decoration:underline');
  });

  it('swaps colours for inverse cells', async () => {
    const screen = await renderAnsiToHtml(`${ESC}[7mx`, { columns: 3, rows: 1 });
    const html = screen.lines[0]?.html ?? '';
    expect(html).toContain('color:#141414');
    expect(html).toContain('background:#d4d4d4');
  });

  it('escapes HTML metacharacters in terminal text', async () => {
    const screen = await renderAnsiToHtml('<b>&"', { columns: 10, rows: 1 });
    expect(screen.lines[0]?.html).toContain('&lt;b&gt;&amp;&quot;');
  });

  it('keeps wide characters on one cell', async () => {
    const screen = await renderAnsiToHtml('漢字', { columns: 6, rows: 1 });
    expect(screen.lines[0]?.text).toBe('漢字');
  });

  it('respects cursor positioning', async () => {
    const screen = await renderAnsiToHtml(`${ESC}[2;3Hxy`, { columns: 10, rows: 3 });
    expect(screen.lines[1]?.text).toBe('  xy');
  });
});

describe('changedRows', () => {
  it('reports only the rows that differ', async () => {
    const before = await renderAnsiToHtml('one\r\ntwo\r\nthree', { columns: 10, rows: 3 });
    const after = await renderAnsiToHtml('one\r\nTWO\r\nthree', { columns: 10, rows: 3 });
    expect([...changedRows(before, after)]).toEqual([1]);
  });

  it('treats a styling-only change as a change', async () => {
    const before = await renderAnsiToHtml('ok', { columns: 4, rows: 1 });
    const after = await renderAnsiToHtml(`${ESC}[31mok`, { columns: 4, rows: 1 });
    expect([...changedRows(before, after)]).toEqual([0]);
  });
});

describe('escapeHtml', () => {
  it('escapes the four dangerous characters', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
