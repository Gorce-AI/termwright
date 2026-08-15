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

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProtocolViolation } from './errors.js';

export const MARKER_DCS_PREFIX = 'twm;';

/** Bytes of HMAC-SHA256 output retained in the marker MAC. */
export const MARKER_MAC_BYTES = 16;

/** Length of the base64url-encoded MAC (16 bytes, unpadded). */
const MARKER_MAC_CHARS = 22;

/** Canonical decimal revision: no sign, no leading zero, no whitespace. */
const REVISION_TEXT = /^[1-9][0-9]{0,15}$/;

/** base64url alphabet, exact MAC length. */
const MAC_TEXT = new RegExp(`^[A-Za-z0-9_-]{${MARKER_MAC_CHARS}}$`);

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
 * @returns The complete `DCS … ST` sequence to write to stdout.
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
  return `\x1bP${MARKER_DCS_PREFIX}${revision};${computeMac(token, sessionId, revision)}\x1b\\`;
}

/**
 * Parse+verify a DCS payload (the part between DCS and ST). Returns null on any mismatch.
 *
 * Total function: hostile payloads yield `null`, never an exception. The MAC
 * comparison is constant-time, and only canonically-formatted revisions are
 * accepted so `1` and `01` cannot both authenticate the same commit.
 *
 * @param payload - DCS payload, i.e. the bytes between `ESC P` and `ESC \`.
 * @param token - Per-launch session token used as the HMAC key.
 * @param sessionId - Session id the marker must be bound to.
 */
export function verifyMarkerPayload(
  payload: string,
  token: string,
  sessionId: string,
): RenderMarker | null {
  if (token.length === 0 || sessionId.length === 0) return null;
  if (!payload.startsWith(MARKER_DCS_PREFIX)) return null;

  const body = payload.slice(MARKER_DCS_PREFIX.length);
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
