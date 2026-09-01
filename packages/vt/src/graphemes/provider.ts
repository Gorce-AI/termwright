/**
 * Termwright-owned Unicode 15 extended-grapheme provider for xterm.
 *
 * The segmentation tables and algorithm are derived from
 * `@xterm/addon-unicode-graphemes` 0.4.0 (MIT). Owning this small boundary lets
 * Termwright fix the upstream pooled-Buffer view bug without mutating global
 * `Buffer.poolSize`, and keeps an experimental addon out of the production
 * dependency graph.
 */
import type { IUnicodeVersionProvider } from '@xterm/headless';
import * as unicode from './unicode-properties.js';

const ZERO_WIDTH_SPACE = 0x20_0b;

function packProperties(charKind: number, width: number, shouldJoin: boolean): number {
  return ((charKind & 0xff_ff_ff) << 3) | ((width & 3) << 1) | (shouldJoin ? 1 : 0);
}

function unpackWidth(value: number): number {
  return (value >> 1) & 3;
}

function unpackCharKind(value: number): number {
  return value >>> 3;
}

/** Unicode 15 provider with UAX #29 extended-grapheme joining enabled. */
export class Unicode15GraphemeProvider implements IUnicodeVersionProvider {
  readonly version = '15-graphemes';
  ambiguousCharsAreWide = false;

  charProperties(codepoint: number, preceding: number): number {
    if (codepoint >= 32 && codepoint < 127 && preceding >> 3 === 0) {
      return packProperties(unicode.GRAPHEME_BREAK_Other, 1, false);
    }
    if (codepoint === ZERO_WIDTH_SPACE) {
      return preceding === 0
        ? packProperties(unicode.GRAPHEME_BREAK_Extend, 0, false)
        : packProperties(unicode.GRAPHEME_BREAK_Extend, unpackWidth(preceding), true);
    }

    let charInfo = unicode.getInfo(codepoint);
    const widthInfo = unicode.infoToWidthInfo(charInfo);
    let width =
      widthInfo >= 2
        ? widthInfo === 3 || this.ambiguousCharsAreWide || codepoint === 0xfe_0f
          ? 2
          : 1
        : 1;
    let shouldJoin = false;
    if (preceding !== 0) {
      const previousWidth = unpackWidth(preceding);
      charInfo = unicode.shouldJoin(unpackCharKind(preceding), charInfo);
      shouldJoin = charInfo > 0;
      if (shouldJoin) {
        if (previousWidth > width) width = previousWidth;
        else if (charInfo === 32) width = 2;
      }
    }
    return packProperties(charInfo, width, shouldJoin);
  }

  wcwidth(codepoint: number): 0 | 1 | 2 {
    if (codepoint === ZERO_WIDTH_SPACE) return 0;
    const charInfo = unicode.getInfo(codepoint);
    const widthInfo = unicode.infoToWidthInfo(charInfo);
    const kind = (charInfo & unicode.GRAPHEME_BREAK_MASK) >> unicode.GRAPHEME_BREAK_SHIFT;
    if (kind === unicode.GRAPHEME_BREAK_Extend || kind === unicode.GRAPHEME_BREAK_Prepend) {
      return 0;
    }
    if (widthInfo >= 2 && (widthInfo === 3 || this.ambiguousCharsAreWide)) return 2;
    return 1;
  }
}
