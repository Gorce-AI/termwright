/**
 * One Unicode provider that carries a whole terminal profile.
 *
 * xterm.js lets exactly one provider be active at a time, so the profile's
 * switches cannot each be an addon: they are folded into a single provider that
 * decorates a base version (Unicode 11, or 15 with grapheme clustering) and
 * overrides the two widths terminals actually disagree about — East Asian
 * Ambiguous characters, and emoji presentation via VS16.
 */
import type { IUnicodeVersionProvider } from '@xterm/headless';

/**
 * Bit layout of the value `charProperties` returns, as used by xterm 6:
 * `(charKind << 3) | (width << 1) | shouldJoin`. It is internal to xterm, so
 * {@link canOverrideWidths} verifies it at runtime before anything relies on it.
 */
function packProperties(charKind: number, width: number, shouldJoin: boolean): number {
  return ((charKind & 0xff_ff_ff) << 3) | ((width & 3) << 1) | (shouldJoin ? 1 : 0);
}

function unpackWidth(value: number): number {
  return (value >> 1) & 3;
}

function unpackShouldJoin(value: number): boolean {
  return (value & 1) === 1;
}

function unpackCharKind(value: number): number {
  return value >>> 3;
}

/** Variation Selector-16: asks for the emoji presentation of the preceding character. */
const VS16 = 0xfe_0f;

/**
 * East Asian Ambiguous ranges, curated.
 *
 * This is deliberately not the whole `EastAsianWidth=A` property: the profile is
 * a switch that reproduces how terminals *differ*, not an emulation of any one
 * of them. What is here is what shows up in terminal user interfaces — box
 * drawing, block elements, arrows, geometric shapes, enclosed alphanumerics,
 * Greek and Cyrillic, typographic punctuation — because those are the
 * characters whose width decides whether a bordered box lines up.
 */
const AMBIGUOUS_RANGES: readonly (readonly [number, number])[] = [
  [0x00a1, 0x00a1], [0x00a4, 0x00a4], [0x00a7, 0x00a8], [0x00aa, 0x00aa],
  [0x00ad, 0x00ae], [0x00b0, 0x00b4], [0x00b6, 0x00ba], [0x00bc, 0x00bf],
  [0x00c6, 0x00c6], [0x00d0, 0x00d0], [0x00d7, 0x00d8], [0x00de, 0x00e1],
  [0x00e6, 0x00e6], [0x00e8, 0x00ea], [0x00ec, 0x00ed], [0x00f0, 0x00f0],
  [0x00f2, 0x00f3], [0x00f7, 0x00fa], [0x00fc, 0x00fc], [0x00fe, 0x00fe],
  [0x0101, 0x0101], [0x0111, 0x0111], [0x0113, 0x0113], [0x011b, 0x011b],
  [0x0126, 0x0127], [0x012b, 0x012b], [0x0131, 0x0133], [0x0138, 0x0138],
  [0x013f, 0x0142], [0x0144, 0x0144], [0x0148, 0x014b], [0x014d, 0x014d],
  [0x0152, 0x0153], [0x0166, 0x0167], [0x016b, 0x016b], [0x01ce, 0x01ce],
  [0x01d0, 0x01d0], [0x01d2, 0x01d2], [0x01d4, 0x01d4], [0x01d6, 0x01d6],
  [0x01d8, 0x01d8], [0x01da, 0x01da], [0x01dc, 0x01dc], [0x0251, 0x0251],
  [0x0261, 0x0261], [0x02c4, 0x02c4], [0x02c7, 0x02c7], [0x02c9, 0x02cb],
  [0x02cd, 0x02cd], [0x02d0, 0x02d0], [0x02d8, 0x02db], [0x02dd, 0x02dd],
  [0x02df, 0x02df], [0x0391, 0x03a1], [0x03a3, 0x03a9], [0x03b1, 0x03c1],
  [0x03c3, 0x03c9], [0x0401, 0x0401], [0x0410, 0x044f], [0x0451, 0x0451],
  [0x2010, 0x2010], [0x2013, 0x2016], [0x2018, 0x2019], [0x201c, 0x201d],
  [0x2020, 0x2022], [0x2024, 0x2027], [0x2030, 0x2030], [0x2032, 0x2033],
  [0x2035, 0x2035], [0x203b, 0x203b], [0x203e, 0x203e], [0x2074, 0x2074],
  [0x207f, 0x207f], [0x2081, 0x2084], [0x20ac, 0x20ac], [0x2103, 0x2103],
  [0x2105, 0x2105], [0x2109, 0x2109], [0x2113, 0x2113], [0x2116, 0x2116],
  [0x2121, 0x2122], [0x2126, 0x2126], [0x212b, 0x212b], [0x2153, 0x2154],
  [0x215b, 0x215e], [0x2160, 0x216b], [0x2170, 0x2179], [0x2189, 0x2189],
  [0x2190, 0x2199], [0x21b8, 0x21b9], [0x21d2, 0x21d2], [0x21d4, 0x21d4],
  [0x21e7, 0x21e7], [0x2200, 0x2200], [0x2202, 0x2203], [0x2207, 0x2208],
  [0x220b, 0x220b], [0x220f, 0x220f], [0x2211, 0x2211], [0x2215, 0x2215],
  [0x221a, 0x221a], [0x221d, 0x2220], [0x2223, 0x2223], [0x2225, 0x2225],
  [0x2227, 0x222c], [0x222e, 0x222e], [0x2234, 0x2237], [0x223c, 0x223d],
  [0x2248, 0x2248], [0x224c, 0x224c], [0x2252, 0x2252], [0x2260, 0x2261],
  [0x2264, 0x2267], [0x226a, 0x226b], [0x226e, 0x226f], [0x2282, 0x2283],
  [0x2286, 0x2287], [0x2295, 0x2295], [0x2299, 0x2299], [0x22a5, 0x22a5],
  [0x22bf, 0x22bf], [0x2312, 0x2312], [0x2460, 0x24e9], [0x24eb, 0x254b],
  [0x2550, 0x2573], [0x2580, 0x258f], [0x2592, 0x2595], [0x25a0, 0x25a1],
  [0x25a3, 0x25a9], [0x25b2, 0x25b3], [0x25b6, 0x25b7], [0x25bc, 0x25bd],
  [0x25c0, 0x25c1], [0x25c6, 0x25c8], [0x25cb, 0x25cb], [0x25ce, 0x25d1],
  [0x25e2, 0x25e5], [0x25ef, 0x25ef], [0x2605, 0x2606], [0x2609, 0x2609],
  [0x260e, 0x260f], [0x2614, 0x2615], [0x261c, 0x261c], [0x261e, 0x261e],
  [0x2640, 0x2640], [0x2642, 0x2642], [0x2660, 0x2661], [0x2663, 0x2665],
  [0x2667, 0x266a], [0x266c, 0x266d], [0x266f, 0x266f], [0x273d, 0x273d],
  [0x2776, 0x277f], [0xe000, 0xf8ff], [0xfffd, 0xfffd],
];

/** True when the code point is East Asian Ambiguous, per the curated table. */
export function isAmbiguousWidth(codepoint: number): boolean {
  let low = 0;
  let high = AMBIGUOUS_RANGES.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = AMBIGUOUS_RANGES[middle];
    if (range === undefined) return false;
    if (codepoint < range[0]) high = middle - 1;
    else if (codepoint > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

/**
 * Verifies that the width bits of `charProperties` are laid out as assumed.
 *
 * The layout is xterm's internal business. Rather than trusting it, the
 * decorator asks the base provider about characters whose width is not in
 * dispute and checks that unpacking and repacking round-trips. If a future
 * xterm changes the encoding, the overrides switch themselves off instead of
 * silently reporting nonsense widths.
 */
export function canOverrideWidths(base: IUnicodeVersionProvider): boolean {
  const samples: readonly (readonly [number, number])[] = [
    [0x0061, 1], // 'a'
    [0x4e00, 2], // CJK ideograph
  ];
  for (const [codepoint, expected] of samples) {
    const value = base.charProperties(codepoint, 0);
    if (unpackWidth(value) !== expected) return false;
    const repacked = packProperties(unpackCharKind(value), unpackWidth(value), unpackShouldJoin(value));
    if (repacked !== value) return false;
  }
  return true;
}

/** The switches a profile applies on top of a base Unicode version. */
export interface UnicodeOverrides {
  /** Count East Asian Ambiguous characters as two columns. */
  readonly ambiguousWide: boolean;
  /** Let VS16 promote the preceding character to an emoji-width cluster. */
  readonly variationSelectors: boolean;
}

/**
 * Wraps a base provider with a profile's overrides.
 *
 * @param version - name the provider registers under; this is what
 * `terminal.unicode.activeVersion` is set to, so it identifies the profile
 * rather than the Unicode version underneath it.
 */
export function createProfileProvider(
  base: IUnicodeVersionProvider,
  version: string,
  overrides: UnicodeOverrides,
): IUnicodeVersionProvider {
  const active = canOverrideWidths(base) && (overrides.ambiguousWide || overrides.variationSelectors);
  if (!active) {
    // Nothing to add, or the encoding is not what we verified: pass the base
    // through under the profile's name rather than guess.
    return { version, wcwidth: (cp) => base.wcwidth(cp), charProperties: (cp, prev) => base.charProperties(cp, prev) };
  }

  const widthOf = (codepoint: number): 0 | 1 | 2 => {
    if (overrides.ambiguousWide && isAmbiguousWidth(codepoint)) return 2;
    return base.wcwidth(codepoint);
  };

  return {
    version,
    wcwidth: widthOf,
    charProperties(codepoint: number, preceding: number): number {
      const value = base.charProperties(codepoint, preceding);
      const charKind = unpackCharKind(value);
      const shouldJoin = unpackShouldJoin(value);
      let width = unpackWidth(value);

      // VS16 joins the previous cell; the width it reports becomes the width of
      // the whole cluster, which is how a terminal renders ❤️ two columns wide
      // while ❤ stays one.
      if (overrides.variationSelectors && codepoint === VS16 && preceding !== 0) {
        return packProperties(charKind, 2, true);
      }
      if (overrides.ambiguousWide && width === 1 && isAmbiguousWidth(codepoint)) {
        width = 2;
      }
      return packProperties(charKind, width, shouldJoin);
    },
  };
}
