/**
 * These tests are the reason the private access is allowed to exist: they fail
 * the moment a future xterm moves the internals, instead of the screen capture
 * quietly reporting that nothing on screen is a link.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createTerminal, type Terminal } from './terminal.js';
import { createLinkResolver } from './links.js';

let term: Terminal | null = null;

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, () => resolve()));
}

function open(): Terminal {
  const { terminal } = createTerminal({ columns: 40, rows: 4 });
  term = terminal;
  return terminal;
}

afterEach(() => {
  term?.dispose();
  term = null;
});

describe('reading OSC 8 links back off the grid', () => {
  it('resolves the uri and id of a linked cell', async () => {
    const terminal = open();
    await write(terminal, '\x1b]8;id=abc;https://example.com/x?y=1\x1b\\LINK\x1b]8;;\x1b\\ plain');
    const resolve = createLinkResolver(terminal);
    const line = terminal.buffer.active.getLine(0);

    expect(resolve(line!.getCell(0)!)).toEqual({ uri: 'https://example.com/x?y=1', id: 'abc' });
    // 'LINK' is four cells; the space after the closer is not part of it.
    expect(resolve(line!.getCell(3)!)?.uri).toBe('https://example.com/x?y=1');
    expect(resolve(line!.getCell(4)!)).toBeNull();
  });

  it('resolves a link written without an id', async () => {
    const terminal = open();
    await write(terminal, '\x1b]8;;https://example.com/plain\x1b\\P\x1b]8;;\x1b\\');
    const link = createLinkResolver(terminal)(terminal.buffer.active.getLine(0)!.getCell(0)!);
    expect(link).toEqual({ uri: 'https://example.com/plain' });
    expect(link && 'id' in link).toBe(false);
  });

  it('keeps only the id, because that is all xterm keeps', async () => {
    // Measured, and load-bearing for anything planning to carry data through a
    // hyperlink: OSC 8 params are key=value:key=value, and every key other
    // than `id` is parsed and thrown away before it reaches the buffer.
    const terminal = open();
    await write(terminal, '\x1b]8;id=abc:frag=btn7:x=1;https://example.com/2\x1b\\B\x1b]8;;\x1b\\');
    const link = createLinkResolver(terminal)(terminal.buffer.active.getLine(0)!.getCell(0)!);

    expect(link).toEqual({ uri: 'https://example.com/2', id: 'abc' });
    expect(JSON.stringify(link)).not.toContain('frag');
  });

  it('answers null for every cell when the internals are not where we look', () => {
    // The degradation that matters: a screen capture must not throw because a
    // dependency moved a private field.
    const resolve = createLinkResolver({} as unknown as Terminal);
    expect(resolve({ getChars: () => 'x' } as never)).toBeNull();
  });
});
