import { describe, expect, it } from 'vitest';
import { createTerminal } from '@termwright/vt';
import { VtScreen } from './vt.js';
import { captureCell, captureScreen } from './screen.js';

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
      [-1, 0], [0, -1], [999, 0], [0, 999], [vt.rows, 0], [0, vt.columns],
      [1.5, 0], [0, 1.5], [Number.NaN, 0],
    ];
    for (const [row, column] of probes) {
      expect(captureCell(vt, row, column)).toEqual(screen.cell(row, column));
    }
    vt.dispose();
  });

  it('follows the viewport after scrolling', async () => {
    // The viewport offset is the part a direct read could easily get wrong:
    // reading absolute buffer lines would silently return scrollback.
    const vt = await paint(`${Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\r\n')}\r\n`);
    const screen = captureScreen(vt);
    for (let row = 0; row < vt.rows; row += 1) {
      expect(captureCell(vt, row, 0)).toEqual(screen.cell(row, 0));
      expect(captureCell(vt, row, 3)).toEqual(screen.cell(row, 3));
    }
    vt.dispose();
  });
});
