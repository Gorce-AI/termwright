/**
 * The emulator used to replay a recording.
 *
 * Construction goes through `@termwright/vt`, and that is the whole point: a session measured characters with
 * one set of width tables and its own replay measured them with another, so a
 * reconstructed frame could sit a column away from the screen the test saw.
 * Nothing threw — the screenshot just disagreed with the assertion. One
 * factory, one profile, no way for the two halves to drift apart again.
 *
 * @internal
 */

import {
  createTerminal as createProfiledTerminal,
  resolveProfileId,
  type Terminal,
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
  // The profile arrives as a string read off disk, so it is looked up rather
  // than trusted: `resolveProfileId` answers with `undefined` for anything it
  // does not know — including keys inherited from Object.prototype — and the
  // failure is reported in this package's own error vocabulary.
  const resolved = profile === undefined ? undefined : resolveProfileId(profile);
  if (profile !== undefined && resolved === undefined) {
    throw new TraceError(
      'protocol-violation',
      `recording asks for terminal profile ${JSON.stringify(profile)}, which this build does not know`,
      {
        suggestion:
          'Upgrade @termwright/vt, or re-record with a profile this build supports. Replaying with the wrong width tables would produce a frame that looks right and is not.',
      },
    );
  }

  return createProfiledTerminal({
    columns,
    rows,
    scrollback: 0,
    ...(resolved === undefined ? {} : { profile: resolved }),
  }).terminal;
}

/** `terminal.write` as a promise; the callback fires once the parser drains. */
export function writeToTerminal(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, resolve);
  });
}
