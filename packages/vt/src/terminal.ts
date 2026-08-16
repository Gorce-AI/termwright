/**
 * The one place a `@xterm/headless` terminal is created.
 *
 * Every consumer — the driver's live session, the trace replay, the screenshot
 * renderer, the runner's terminal pane — must build its emulator here, because
 * a terminal is only comparable to another terminal when both count characters
 * the same way. Constructing one by hand elsewhere is how a replay ends up
 * measuring Unicode 6 while the session that recorded it measured Unicode 11.
 *
 * It also absorbs one upstream trap: `@xterm/headless` and its addons are
 * CJS-only despite shipping `.mjs` builds, so they must be imported through
 * their default export. That workaround lives here once instead of in every
 * package.
 */
import xh from '@xterm/headless';
import serializeAddon from '@xterm/addon-serialize';
import unicode11Addon from '@xterm/addon-unicode11';
import type {
  IBuffer,
  IBufferCell,
  IBufferLine,
  ITerminalAddon,
  IUnicodeVersionProvider,
  Terminal,
} from '@xterm/headless';
import { resolveProfile, type TerminalProfile, type TerminalProfileLike } from './profiles.js';
import { captureAddonProvider, createProfileProvider, type UnicodeAddonLike } from './unicode.js';

/** Options for {@link createTerminal}. */
export interface CreateTerminalOptions {
  readonly columns: number;
  readonly rows: number;
  /** Lines of scrollback retained; 0 keeps none. */
  readonly scrollback?: number;
  /** Profile id, a custom profile, or nothing for the default. */
  readonly profile?: TerminalProfileLike;
}

/** A terminal together with the profile it was built with. */
export interface ProfiledTerminal {
  readonly terminal: Terminal;
  readonly profile: TerminalProfile;
}

/**
 * Creates a headless terminal that counts characters according to `profile`.
 *
 * The profile is registered as the active Unicode version under its own id, so
 * `terminal.unicode.activeVersion` answers "which profile is this terminal
 * using" — the question a replay or a screenshot actually needs answered.
 */
export function createTerminal(options: CreateTerminalOptions): ProfiledTerminal {
  const profile = resolveProfile(options.profile);
  const terminal = new xh.Terminal({
    cols: options.columns,
    rows: options.rows,
    scrollback: options.scrollback ?? 0,
    allowProposedApi: true,
    convertEol: false,
    reflowCursorLine: profile.reflowCursorLineOnResize,
  });

  const base = loadBaseProvider(profile);
  terminal.unicode.register(
    createProfileProvider(base, profile.id, {
      ambiguousWide: profile.ambiguousWide,
      variationSelectors: profile.variationSelectors,
    }),
  );
  // Registering is not enough: a provider only applies once it is made active.
  terminal.unicode.activeVersion = profile.id;

  return { terminal, profile };
}

/**
 * Builds the base provider for a profile's Unicode version.
 *
 * The addons do not export their providers, but `activate(terminal)` only ever
 * calls `terminal.unicode.register(...)`. Handing one a stub that captures the
 * registration yields the provider through public API, without reading private
 * fields and without registering versions on the real terminal that nobody
 * asked for.
 */
function loadBaseProvider(profile: TerminalProfile): IUnicodeVersionProvider {
  return captureAddonProvider(
    new unicode11Addon.Unicode11Addon() as unknown as UnicodeAddonLike,
    profile.unicodeVersion,
  );
}

/**
 * Loads the serialize addon. Kept here so consumers do not each rediscover the
 * CJS default-import workaround.
 */
export function loadSerializeAddon(terminal: Terminal): {
  serialize(options?: { scrollback?: number }): string;
  serializeAsHTML(options?: { scrollback?: number }): string;
} {
  const addon = new serializeAddon.SerializeAddon();
  terminal.loadAddon(addon as unknown as ITerminalAddon);
  return addon;
}

export type { IBuffer, IBufferCell, IBufferLine, Terminal };
