/**
 * Terminal profiles.
 *
 * Termwright always uses one modern extended-grapheme model. Profiles contain
 * only genuine terminal-policy differences: ambiguous width and resize reflow.
 *
 * It is deliberately NOT an emulation of a particular terminal. The profiles
 * are not Unicode-version selectors and do not emulate branded terminals.
 */

/** Identifiers of the built-in profiles. */
export type TerminalProfileId = 'default' | 'cjk-wide';

/** A named set of the switches terminals differ on. */
export interface TerminalProfile {
  readonly id: string;
  /** Policy for East Asian Ambiguous characters. */
  readonly ambiguousWidth: 'narrow' | 'wide';
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
 * Modern extended graphemes with narrow East Asian Ambiguous characters.
 */
export const DEFAULT_PROFILE: TerminalProfile = Object.freeze({
  id: 'default',
  ambiguousWidth: 'narrow',
  reflowCursorLineOnResize: true,
});

/** Modern extended graphemes with wide East Asian Ambiguous characters. */
export const CJK_WIDE_PROFILE: TerminalProfile = Object.freeze({
  id: 'cjk-wide',
  ambiguousWidth: 'wide',
  reflowCursorLineOnResize: true,
});

/** Every built-in profile, by id. */
export const TERMINAL_PROFILES: Readonly<Record<TerminalProfileId, TerminalProfile>> =
  Object.freeze({
    default: DEFAULT_PROFILE,
    'cjk-wide': CJK_WIDE_PROFILE,
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
  return Object.hasOwn(TERMINAL_PROFILES, id)
    ? TERMINAL_PROFILES[id as TerminalProfileId]
    : undefined;
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
