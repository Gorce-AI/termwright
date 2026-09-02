/**
 * `@termwright/vt/unicode` — the half of this package that never touches Node.
 *
 * The main entry builds a `@xterm/headless` terminal, which pulls Node into a
 * bundle. A browser consumer needs the other half: the profile definitions, the
 * width tables and the provider that applies them, so it can put the same
 * profile on a `@xterm/xterm` terminal it created itself.
 *
 * @example
 * ```ts
 * import { applyProfile, resolveProfileId } from '@termwright/vt/unicode';
 *
 * const profile = resolveProfileId(recording.terminalProfile) ?? DEFAULT_PROFILE;
 * applyProfile(term.unicode, profile);
 * ```
 */
export {
  applyProfile,
  createProfileProvider,
  isAmbiguousWidth,
  type UnicodeHandlingLike,
  type UnicodeOverrides,
} from './unicode.js';

export {
  DEFAULT_PROFILE,
  CJK_WIDE_PROFILE,
  TERMINAL_PROFILES,
  resolveProfile,
  resolveProfileId,
  type TerminalProfile,
  type TerminalProfileId,
  type TerminalProfileLike,
} from './profiles.js';
