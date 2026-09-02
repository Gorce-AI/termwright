/**
 * `@termwright/vt` — the VT core every termwright package shares.
 *
 * A live session, a replay of that session, a screenshot of that replay and the
 * runner pane showing it must all count characters identically, or the same
 * bytes produce three different screens. This package owns the one terminal
 * factory and the one profile that makes them comparable.
 *
 * @example
 * ```ts
 * import { createTerminal } from '@termwright/vt';
 *
 * const { terminal, profile } = createTerminal({ columns: 100, rows: 30 });
 * terminal.write('❤️');
 * console.log(profile.id); // written into the recording so the replay matches
 * ```
 */
export {
  createTerminal,
  loadSerializeAddon,
  type CreateTerminalOptions,
  type IBuffer,
  type IBufferCell,
  type IBufferLine,
  type ProfiledTerminal,
  type Terminal,
} from './terminal.js';

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

export { createLinkResolver, type CellLink, type LinkResolver } from './links.js';

export { isAmbiguousWidth, type UnicodeOverrides } from './unicode.js';
export { measureTextCellWidth } from './graphemes/provider.js';
