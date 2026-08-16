/**
 * The emulator used to replay a recording.
 *
 * Construction goes through `@termwright/vt` rather than `@xterm/headless`
 * directly, and that is the whole point: a session measured characters with
 * one set of width tables and its own replay measured them with another, so a
 * reconstructed frame could sit a column away from the screen the test saw.
 * Nothing threw — the screenshot just disagreed with the assertion. One
 * factory, one profile, no way for the two halves to drift apart again.
 *
 * @internal
 */

import {
  createTerminal as createProfiledTerminal,
  type Terminal,
  type TerminalProfileLike,
} from '@termwright/vt';
import { TraceError } from './errors.js';

/**
 * Creates a headless terminal for replay, with no scrollback — a reconstructed
 * frame is the viewport.
 *
 * @param profile - profile id from `meta.terminalProfile`, or a profile object
 * @throws TraceError `protocol-violation` when the recording names a profile
 *   this build does not know: replaying it with the wrong width tables would
 *   produce a frame that looks right and is not.
 */
export function createTerminal(columns: number, rows: number, profile?: string): Terminal {
  try {
    return createProfiledTerminal({
      columns,
      rows,
      scrollback: 0,
      // `TerminalProfileLike` is a union of known ids, which is right for a
      // caller that knows its profile at compile time. This one reads a string
      // off disk, so the check has to happen at runtime — `resolveProfile`
      // does exactly that and throws, which the catch below turns into a
      // TraceError.
      ...(profile === undefined ? {} : { profile: profile as TerminalProfileLike }),
    }).terminal;
  } catch (cause) {
    throw new TraceError(
      'protocol-violation',
      `recording asks for terminal profile ${JSON.stringify(profile)}, which this build does not know`,
      {
        suggestion:
          cause instanceof Error
            ? cause.message
            : 'Upgrade @termwright/vt, or re-record with a profile this build supports.',
      },
    );
  }
}

/** `terminal.write` as a promise; the callback fires once the parser drains. */
export function writeToTerminal(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, resolve);
  });
}
