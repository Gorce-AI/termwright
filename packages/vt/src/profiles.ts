/**
 * Terminal profiles.
 *
 * Terminals disagree about a handful of things that decide whether a bordered
 * box lines up: how wide an ambiguous character is, whether VS16 makes an emoji
 * two columns, which Unicode version's width tables apply, and whether wrapped
 * lines reflow on resize. A profile is a named set of those switches.
 *
 * It is deliberately NOT an emulation of a particular terminal. Three profiles
 * exist because they cover the three answers real terminals give; naming one
 * after kitty means "this is how kitty answers", not "this is kitty".
 */

/**
 * Base width tables a profile builds on.
 *
 * Only Unicode 11 today. Grapheme clustering (Unicode 15) was the intended
 * second option, but `@xterm/addon-unicode-graphemes` — 0.4.0 and 0.5.0-beta
 * alike — never finishes loading inside a vitest worker, in either pool and
 * even through `createRequire`, while plain Node imports it in 20 ms. Every
 * package here tests with vitest, so shipping a profile that needs it would
 * hang the suites of everyone who imports this package. See NOTES.md.
 */
export type UnicodeVersion = '11';

/** Identifiers of the built-in profiles. */
export type TerminalProfileId = 'default' | 'kitty' | 'iterm2-ambiguous-wide';

/** A named set of the switches terminals differ on. */
export interface TerminalProfile {
  readonly id: string;
  /**
   * `'11'` uses Unicode 11 width tables (what most terminals ship);
   * `'15-graphemes'` adds Unicode 15 tables and grapheme clustering, so a
   * ZWJ sequence occupies one cluster instead of several.
   */
  readonly unicodeVersion: UnicodeVersion;
  /** Count East Asian Ambiguous characters as two columns. */
  readonly ambiguousWide: boolean;
  /** Let VS16 promote the preceding character to an emoji-width cluster. */
  readonly variationSelectors: boolean;
  /**
   * Reflow the cursor's line when the terminal is resized.
   *
   * Named for exactly what it reaches: xterm.js always reflows *wrapped* lines
   * and the only choice it offers a host is what happens to the line the cursor
   * is on. A field called `reflowOnResize` would have promised control over
   * something the emulator does unconditionally.
   */
  readonly reflowCursorLineOnResize: boolean;
}

/**
 * The conservative default: Unicode 11 widths, narrow ambiguous characters, no
 * VS16 promotion. Matches what the majority of terminals do today and what the
 * driver did before profiles existed.
 */
export const DEFAULT_PROFILE: TerminalProfile = Object.freeze({
  id: 'default',
  unicodeVersion: '11',
  ambiguousWide: false,
  variationSelectors: false,
  reflowCursorLineOnResize: true,
});

/**
 * Emoji presentation, the way kitty answers: a VS16 sequence occupies two
 * columns. Grapheme clustering is intended to join it here once the upstream
 * addon can be loaded (see {@link UnicodeVersion}).
 */
export const KITTY_PROFILE: TerminalProfile = Object.freeze({
  id: 'kitty',
  unicodeVersion: '11',
  ambiguousWide: false,
  variationSelectors: true,
  reflowCursorLineOnResize: true,
});

/** Wide ambiguous characters, the way iTerm2 answers when configured for CJK. */
export const ITERM2_AMBIGUOUS_WIDE_PROFILE: TerminalProfile = Object.freeze({
  id: 'iterm2-ambiguous-wide',
  unicodeVersion: '11',
  ambiguousWide: true,
  variationSelectors: true,
  reflowCursorLineOnResize: true,
});

/** Every built-in profile, by id. */
export const TERMINAL_PROFILES: Readonly<Record<TerminalProfileId, TerminalProfile>> = Object.freeze({
  default: DEFAULT_PROFILE,
  kitty: KITTY_PROFILE,
  'iterm2-ambiguous-wide': ITERM2_AMBIGUOUS_WIDE_PROFILE,
});

/** Anything a caller may pass where a profile is expected. */
export type TerminalProfileLike = TerminalProfileId | TerminalProfile | undefined;

/**
 * Looks up a built-in profile by a plain string, without throwing.
 *
 * `resolveProfile` is for callers that know the id at compile time. A caller
 * reading a profile out of a recording holds an arbitrary string, and should
 * report an unknown one in its own vocabulary — a trace says the archive is
 * malformed, a UI says the recording cannot be replayed — rather than catching
 * an exception from here.
 */
export function resolveProfileId(id: string): TerminalProfile | undefined {
  // Own properties only: the caller's string comes from a file, and a plain
  // lookup would answer '__proto__' with Object.prototype.
  return Object.hasOwn(TERMINAL_PROFILES, id) ? TERMINAL_PROFILES[id as TerminalProfileId] : undefined;
}

/**
 * Resolves an id, a custom profile, or nothing at all into a profile.
 * An unknown id is a programmer error and says so, rather than silently
 * falling back to the default and producing widths nobody asked for.
 */
export function resolveProfile(profile: TerminalProfileLike): TerminalProfile {
  if (profile === undefined) return DEFAULT_PROFILE;
  if (typeof profile !== 'string') return profile;
  const known = resolveProfileId(profile);
  if (known === undefined) {
    throw new TypeError(
      `unknown terminal profile ${JSON.stringify(profile)}; built-ins are ${Object.keys(TERMINAL_PROFILES).join(', ')}`,
    );
  }
  return known;
}
