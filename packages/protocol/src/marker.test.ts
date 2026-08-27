import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ProtocolViolation } from './errors.js';
import {
  MARKER_MAC_BYTES,
  MARKER_OSC_CODE,
  MARKER_OSC_PREFIX,
  encodeMarker,
  verifyMarkerPayload,
} from './marker.js';

const TOKEN = 'b4f1c0de'.repeat(8);
const SESSION = 'session-1';
const ESC = '\x1b';
const BEL = '\x07';
const ST = '\x1b\\';

/** Extract the OSC payload — what a VT handler is handed after the number. */
function payloadOf(sequence: string): string {
  const opener = `${ESC}]${MARKER_OSC_CODE};`;
  expect(sequence.startsWith(opener)).toBe(true);
  expect(sequence.endsWith(BEL)).toBe(true);
  return sequence.slice(opener.length, -BEL.length);
}

describe('encodeMarker', () => {
  it('emits a private OSC sequence terminated by BEL', () => {
    const sequence = encodeMarker(TOKEN, SESSION, 42);
    expect(sequence.startsWith(`${ESC}]8487;`)).toBe(true);
    expect(sequence.endsWith(BEL)).toBe(true);

    const payload = payloadOf(sequence);
    expect(payload.startsWith(MARKER_OSC_PREFIX)).toBe(true);
    const [revision, mac] = payload.slice(MARKER_OSC_PREFIX.length).split(';');
    expect(revision).toBe('42');
    // base64url of 16 bytes, unpadded.
    expect(mac).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('uses only the cross-platform certified OSC/BEL encoding', () => {
    const sequence = encodeMarker(TOKEN, SESSION, 1);
    expect(sequence).not.toContain(`${ESC}P`);
    expect(sequence).not.toContain(`${ESC}_`);
    expect(sequence).not.toContain(ST);
  });

  it('derives the MAC from HMAC-SHA256 over `sessionId:revision`', () => {
    const expected = createHmac('sha256', TOKEN)
      .update(`${SESSION}:7`, 'utf8')
      .digest()
      .subarray(0, MARKER_MAC_BYTES)
      .toString('base64url');
    expect(payloadOf(encodeMarker(TOKEN, SESSION, 7))).toBe(`${MARKER_OSC_PREFIX}7;${expected}`);
  });

  it('never leaks the token into the emitted bytes', () => {
    expect(encodeMarker(TOKEN, SESSION, 3)).not.toContain(TOKEN);
  });

  it('rejects revisions outside the positive safe-integer domain', () => {
    for (const revision of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => encodeMarker(TOKEN, SESSION, revision)).toThrow(ProtocolViolation);
    }
  });

  it('rejects an empty token or sessionId', () => {
    expect(() => encodeMarker('', SESSION, 1)).toThrow(ProtocolViolation);
    expect(() => encodeMarker(TOKEN, '', 1)).toThrow(ProtocolViolation);
  });
});

describe('verifyMarkerPayload', () => {
  it('accepts a payload it produced itself', () => {
    const payload = payloadOf(encodeMarker(TOKEN, SESSION, 99));
    expect(verifyMarkerPayload(payload, TOKEN, SESSION)).toEqual({
      revision: 99,
      mac: expect.any(String) as unknown as string,
    });
  });

  it('accepts the payload with either terminator still attached', () => {
    // A VT parser strips the terminator; a regex scanning raw output may not.
    const payload = payloadOf(encodeMarker(TOKEN, SESSION, 12));
    expect(verifyMarkerPayload(payload, TOKEN, SESSION)).not.toBeNull();
    expect(verifyMarkerPayload(payload + BEL, TOKEN, SESSION)).not.toBeNull();
    expect(verifyMarkerPayload(payload + ST, TOKEN, SESSION)).not.toBeNull();
  });

  it('returns a frozen marker', () => {
    const marker = verifyMarkerPayload(payloadOf(encodeMarker(TOKEN, SESSION, 1)), TOKEN, SESSION);
    expect(Object.isFrozen(marker)).toBe(true);
  });

  it('rejects a MAC minted with a different token', () => {
    expect(
      verifyMarkerPayload(payloadOf(encodeMarker('other-token', SESSION, 5)), TOKEN, SESSION),
    ).toBeNull();
  });

  it('rejects a MAC bound to a different session', () => {
    expect(
      verifyMarkerPayload(payloadOf(encodeMarker(TOKEN, 'session-2', 5)), TOKEN, SESSION),
    ).toBeNull();
  });

  it('rejects a MAC replayed onto a different revision', () => {
    const valid = payloadOf(encodeMarker(TOKEN, SESSION, 5));
    const mac = valid.slice(valid.indexOf(';', MARKER_OSC_PREFIX.length) + 1);
    expect(verifyMarkerPayload(`${MARKER_OSC_PREFIX}6;${mac}`, TOKEN, SESSION)).toBeNull();
  });

  it('rejects a single flipped MAC character', () => {
    const valid = payloadOf(encodeMarker(TOKEN, SESSION, 5));
    const flipped = valid.slice(0, -1) + (valid.endsWith('A') ? 'B' : 'A');
    expect(verifyMarkerPayload(flipped, TOKEN, SESSION)).toBeNull();
  });

  it('rejects non-canonical revisions so one commit has one encoding', () => {
    for (const text of ['05', '+5', ' 5', '5 ', '0x5', '5.0', '1e3', '']) {
      const payload = `${MARKER_OSC_PREFIX}${text};${'A'.repeat(22)}`;
      expect(verifyMarkerPayload(payload, TOKEN, SESSION)).toBeNull();
    }
  });

  it('rejects revisions beyond the safe-integer range', () => {
    const payload = `${MARKER_OSC_PREFIX}9007199254740993;${'A'.repeat(22)}`;
    expect(verifyMarkerPayload(payload, TOKEN, SESSION)).toBeNull();
  });

  it('rejects malformed payloads without throwing', () => {
    const hostile = [
      '',
      'twm',
      'twm;',
      'twm;1',
      'other;1;AAAAAAAAAAAAAAAAAAAAAA',
      // The OSC number must already be stripped by the caller; leaving it in
      // means the payload does not start with the tag.
      `8487;${MARKER_OSC_PREFIX}1;${'A'.repeat(22)}`,
      `${MARKER_OSC_PREFIX}1;short`,
      `${MARKER_OSC_PREFIX}1;${'A'.repeat(23)}`,
      `${MARKER_OSC_PREFIX}1;${'+'.repeat(22)}`,
      `${MARKER_OSC_PREFIX}1;${'A'.repeat(22)};extra`,
      `${MARKER_OSC_PREFIX}\uD800;${'A'.repeat(22)}`,
      `${MARKER_OSC_PREFIX}1;${'A'.repeat(10_000)}`,
    ];
    for (const payload of hostile) {
      expect(verifyMarkerPayload(payload, TOKEN, SESSION)).toBeNull();
    }
  });

  it('rejects everything when the token or session is empty', () => {
    const payload = payloadOf(encodeMarker(TOKEN, SESSION, 1));
    expect(verifyMarkerPayload(payload, '', SESSION)).toBeNull();
    expect(verifyMarkerPayload(payload, TOKEN, '')).toBeNull();
  });
});
