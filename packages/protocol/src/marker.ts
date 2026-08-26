/**
 * Render-commit marker: emitted by the adapter into the PTY stdout AFTER the
 * last byte of the render belonging to revision N. It is a frame COMMIT
 * signal (Neovim `flush` semantics), never a data carrier.
 *
 * Encoding: a private OSC sequence terminated by BEL:
 *
 *   OSC 8487 ; 'twm;' <revision> ';' <mac> BEL
 *   i.e. `\x1b]8487;twm;{rev};{mac}\x07`
 *
 * where mac = base64url(HMAC-SHA256(token, `${sessionId}:${revision}`))
 * truncated to 16 bytes. The driver's VT layer registers an OSC handler,
 * verifies the MAC, and removes the sequence from the visible grid. Ordinary
 * application output cannot forge it. Emitted only after a successful
 * handshake; never during a normal (non-instrumented) run.
 *
 * ## Why OSC and not DCS
 *
 * The legacy, frame-based inbox ConPTY rewrote the stream it forwarded. A
 * permeability probe showed it dropping DCS, APC and OSC 8 while passing
 * private OSC with either terminator, and OSC 133. DCS therefore could not
 * carry a marker on the original Windows backend. The pinned passthrough
 * ConPTY now forwards those families, but OSC 8487 remains the single encoding
 * certified across every supported platform.
 *
 * One encoding is used everywhere rather than negotiating per platform: two
 * paths double the surface that has to stay correct, and the path used least
 * is the one that rots unnoticed. BEL is emitted rather than ST because it is
 * the terminator ConPTY was observed to forward most reliably; receivers
 * accept both, since a VT parser consumes the terminator before dispatching
 * anyway.
 *
 * ## Why 8487
 *
 * OSC numbers have no registry, only convention, so the number is chosen to
 * sit clear of everything in use: xterm's allocations (0–14, 46, 50, 52, 104,
 * 110–119), OSC 8 hyperlinks, 9 and 1337 (iTerm2), 99 and 30001 (kitty), 133
 * (FinalTerm shell integration — also the sequence ConPTY is known to
 * forward), 633 (VS Code), 697 (ConEmu) and 777–779 (urxvt/VTE). 8487 is the
 * ASCII codes of `T` and `W` — termwright — and appears in none of them.
 *
 * The `twm;` tag after the number is kept as a self-identifying guard: if
 * anything ever does claim 8487, a marker still says what it is instead of
 * being mistaken for that other feature's payload.
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProtocolViolation } from './errors.js';

/** The private OSC number carrying render-commit markers. */
export const MARKER_OSC_CODE = 8487;

/**
 * The tag opening a marker payload, immediately after `OSC 8487;`.
 *
 * A VT parser hands an OSC handler everything after the number and its
 * separator, which is exactly what {@link verifyMarkerPayload} expects:
 *
 * ```ts
 * term.parser.registerOscHandler(MARKER_OSC_CODE, (data) => {
 *   const marker = verifyMarkerPayload(data, token, sessionId);
 *   if (marker !== null) commit(marker.revision);
 *   return true; // consumed: keeps the sequence out of the visible grid
 * });
 * ```
 */
export const MARKER_OSC_PREFIX = 'twm;';

/** Bytes of HMAC-SHA256 output retained in the marker MAC. */
export const MARKER_MAC_BYTES = 16;

/** Length of the base64url-encoded MAC (16 bytes, unpadded). */
const MARKER_MAC_CHARS = 22;

/** Canonical decimal revision: no sign, no leading zero, no whitespace. */
const REVISION_TEXT = /^[1-9][0-9]{0,15}$/;

/** base64url alphabet, exact MAC length. */
const MAC_TEXT = new RegExp(`^[A-Za-z0-9_-]{${MARKER_MAC_CHARS}}$`);

/** BEL, the terminator this implementation emits. */
const BEL = '\x07';

/** ST, the terminator a receiver must also accept. */
const ST = '\x1b\\';

export interface RenderMarker {
  readonly revision: number;
  readonly mac: string;
}

function computeMac(token: string, sessionId: string, revision: number): string {
  return createHmac('sha256', token)
    .update(`${sessionId}:${revision}`, 'utf8')
    .digest()
    .subarray(0, MARKER_MAC_BYTES)
    .toString('base64url');
}

/**
 * Build the full escape sequence for a marker.
 *
 * @param token - Per-launch session token (`TERMWRIGHT_TOKEN`); used as the
 * HMAC key and never appears in the emitted bytes.
 * @param sessionId - Session id from the handshake, bound into the MAC so a
 * marker from one session cannot be replayed into another.
 * @param revision - Positive safe integer identifying the committed render.
 * @returns The complete `OSC … BEL` sequence to write to stdout.
 * @throws {ProtocolViolation} If the revision is not a positive safe integer,
 * or the token/sessionId are empty.
 */
export function encodeMarker(token: string, sessionId: string, revision: number): string {
  if (token.length === 0) {
    throw new ProtocolViolation('marker-argument', 'token must not be empty');
  }
  if (sessionId.length === 0) {
    throw new ProtocolViolation('marker-argument', 'sessionId must not be empty');
  }
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new ProtocolViolation('marker-argument', 'revision must be a positive safe integer');
  }
  const mac = computeMac(token, sessionId, revision);
  return `\x1b]${MARKER_OSC_CODE};${MARKER_OSC_PREFIX}${revision};${mac}${BEL}`;
}

/**
 * Parse+verify an OSC payload (the part after `OSC 8487;`). Returns null on any mismatch.
 *
 * Total function: hostile payloads yield `null`, never an exception. The MAC
 * comparison is constant-time, and only canonically-formatted revisions are
 * accepted so `1` and `01` cannot both authenticate the same commit.
 *
 * A trailing BEL or ST is tolerated. A VT parser consumes the terminator
 * before dispatching, so a handler normally passes a payload without one,
 * while a caller scanning raw output with a regex may keep it — both must work.
 *
 * @param payload - Everything after `OSC 8487;`, i.e. `twm;{rev};{mac}`.
 * @param token - Per-launch session token used as the HMAC key.
 * @param sessionId - Session id the marker must be bound to.
 */
export function verifyMarkerPayload(
  payload: string,
  token: string,
  sessionId: string,
): RenderMarker | null {
  if (token.length === 0 || sessionId.length === 0) return null;

  let text = payload;
  if (text.endsWith(BEL)) text = text.slice(0, -BEL.length);
  else if (text.endsWith(ST)) text = text.slice(0, -ST.length);

  if (!text.startsWith(MARKER_OSC_PREFIX)) return null;

  const body = text.slice(MARKER_OSC_PREFIX.length);
  const separator = body.indexOf(';');
  if (separator < 0) return null;

  const revisionText = body.slice(0, separator);
  const mac = body.slice(separator + 1);
  if (!REVISION_TEXT.test(revisionText)) return null;
  if (!MAC_TEXT.test(mac)) return null;

  const revision = Number(revisionText);
  if (!Number.isSafeInteger(revision) || revision <= 0) return null;

  const expected = Buffer.from(computeMac(token, sessionId, revision), 'utf8');
  const actual = Buffer.from(mac, 'utf8');
  // Both are MARKER_MAC_CHARS ASCII bytes by construction, but guard anyway:
  // timingSafeEqual throws on a length mismatch.
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  return Object.freeze({ revision, mac });
}
