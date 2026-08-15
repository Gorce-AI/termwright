/**
 * Render-commit marker: emitted by the adapter into the PTY stdout AFTER the
 * last byte of the render belonging to revision N. It is a frame COMMIT
 * signal (Neovim `flush` semantics), never a data carrier.
 *
 * Encoding: a private DCS sequence (APC is not parsed by xterm.js headless):
 *
 *   DCS + 'twm;' + <revision> + ';' + <mac> + ST
 *   i.e. `\x1bPtwm;{rev};{mac}\x1b\\`
 *
 * where mac = base64url(HMAC-SHA256(token, `${sessionId}:${revision}`))
 * truncated to 16 bytes. The driver's VT layer registers a DCS handler,
 * verifies the MAC, and removes the sequence from the visible grid. Ordinary
 * application output cannot forge it. Emitted only after a successful
 * handshake; never during a normal (non-instrumented) run.
 */

export const MARKER_DCS_PREFIX = 'twm;';

export interface RenderMarker {
  readonly revision: number;
  readonly mac: string;
}

/** Build the full escape sequence for a marker. */
export declare function encodeMarker(
  token: string,
  sessionId: string,
  revision: number,
): string;

/** Parse+verify a DCS payload (the part between DCS and ST). Returns null on any mismatch. */
export declare function verifyMarkerPayload(
  payload: string,
  token: string,
  sessionId: string,
): RenderMarker | null;
