import { describe, expect, it, vi } from 'vitest';
import { VtScreen } from './vt.js';
import { captureCell, captureRows, captureScreen, captureText } from './screen.js';

/**
 * The fast path has to be indistinguishable from the slow one.
 *
 * `screen().cell(y, x)` builds every cell in the viewport to return one of
 * them; `captureCell` reads that one. The only thing making the shortcut
 * legitimate is that the two agree everywhere, including the corners where a
 * wide character, a hyperlink or an out-of-range coordinate changes the
 * answer — so the corpus below is deliberately made of those.
 */
async function paint(content: string, columns = 40, rows = 8): Promise<VtScreen> {
  const vt = new VtScreen({ columns, rows, scrollbackLines: 200 });
  await vt.write(Buffer.from(content, 'utf8'));
  await vt.drain();
  return vt;
}

const CORPUS: readonly (readonly [string, string])[] = [
  ['plain ASCII', 'hello world\r\nsecond line\r\n'],
  ['styled runs', '[1;31mbold red[0m normal [4munderline[0m\r\n'],
  ['256 colour and rgb', '[38;5;208mpalette[0m [38;2;10;20;30mtruecolor[0m\r\n'],
  ['wide characters', '家族 CJK 家\r\n'],
  ['emoji with modifiers', '👍🏽 done 😀\r\n'],
  ['combining marks', 'é ä õ\r\n'],
  ['hyperlink', ']8;;https://example.comlink text]8;; after\r\n'],
  ['inverse and dim', '[7minverse[0m [2mdim[0m\r\n'],
  ['trailing blanks', 'short\r\n\r\n\r\n'],
];

describe('direct cell reads', () => {
  for (const [name, content] of CORPUS) {
    it(`matches the full screen for ${name}`, async () => {
      const vt = await paint(content);
      const screen = captureScreen(vt);
      for (let row = 0; row < vt.rows; row += 1) {
        for (let column = 0; column < vt.columns; column += 1) {
          expect(captureCell(vt, row, column)).toEqual(screen.cell(row, column));
        }
      }
      vt.dispose();
    });
  }

  it('answers out-of-range coordinates exactly as the screen does', async () => {
    const vt = await paint('edge\r\n');
    const screen = captureScreen(vt);
    const probes: readonly (readonly [number, number])[] = [
      [-1, 0],
      [0, -1],
      [999, 0],
      [0, 999],
      [vt.rows, 0],
      [0, vt.columns],
      [1.5, 0],
      [0, 1.5],
      [Number.NaN, 0],
    ];
    for (const [row, column] of probes) {
      expect(captureCell(vt, row, column)).toEqual(screen.cell(row, column));
    }
    vt.dispose();
  });

  it('follows the viewport after scrolling', async () => {
    // The viewport offset is the part a direct read could easily get wrong:
    // reading absolute buffer lines would silently return scrollback.
    const vt = await paint(
      `${Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\r\n')}\r\n`,
    );
    const screen = captureScreen(vt);
    for (let row = 0; row < vt.rows; row += 1) {
      expect(captureCell(vt, row, 0)).toEqual(screen.cell(row, 0));
      expect(captureCell(vt, row, 3)).toEqual(screen.cell(row, 3));
    }
    vt.dispose();
  });
});

describe('direct cell reads stay a fast path', () => {
  it('reads exactly the requested cell', async () => {
    const vt = await paint('first row\r\nsecond row\r\n');
    const buffer = vt.terminal.buffer.active;
    const line = buffer.getLine(buffer.viewportY);
    if (line === undefined) throw new Error('painted viewport has no first line');
    const cell = line.getCell(0);
    if (cell === undefined) throw new Error('painted viewport has no first cell');
    const readBold = vi.spyOn(Object.getPrototypeOf(cell) as typeof cell, 'isBold');
    readBold.mockClear();

    captureCell(vt, 1, 3);

    expect(readBold).toHaveBeenCalledOnce();
    readBold.mockRestore();
    vt.dispose();
  });
});

/**
 * waitForText polls, so the cost of reading the screen as text is paid on
 * every iteration of every wait. captureText must produce exactly the string
 * captureRows would have joined, or a wait would start matching against
 * something subtly different from what the screen actually shows.
 */
describe('text-only capture', () => {
  for (const [name, content] of CORPUS) {
    it(`matches the joined row text for ${name}`, async () => {
      const vt = await paint(content);
      expect(captureText(vt)).toBe(
        captureRows(vt)
          .map((row) => row.text)
          .join('\n'),
      );
      vt.dispose();
    });
  }

  it('matches after scrolling past the viewport', async () => {
    const vt = await paint(
      `${Array.from({ length: 40 }, (_, index) => `row ${index}`).join('\r\n')}\r\n`,
    );
    expect(captureText(vt)).toBe(
      captureRows(vt)
        .map((row) => row.text)
        .join('\n'),
    );
    vt.dispose();
  });

  it('keeps trailing blank rows, which a substring search can depend on', async () => {
    const vt = await paint('only one line\r\n');
    const expected = captureRows(vt)
      .map((row) => row.text)
      .join('\n');
    expect(captureText(vt)).toBe(expected);
    expect(captureText(vt).split('\n')).toHaveLength(vt.rows);
    vt.dispose();
  });
});

describe('text-only capture stays a fast path', () => {
  it('does not materialise cells', async () => {
    const vt = await paint('first row\r\nsecond row\r\n');
    const buffer = vt.terminal.buffer.active;
    const line = buffer.getLine(buffer.viewportY);
    if (line === undefined) throw new Error('painted viewport has no first line');
    const cell = line.getCell(0);
    if (cell === undefined) throw new Error('painted viewport has no first cell');
    const readBold = vi.spyOn(Object.getPrototypeOf(cell) as typeof cell, 'isBold');
    readBold.mockClear();

    captureText(vt);

    expect(readBold).not.toHaveBeenCalled();
    readBold.mockRestore();
    vt.dispose();
  });
});
