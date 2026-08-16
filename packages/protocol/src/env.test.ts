import { describe, expect, it } from 'vitest';
import { PROTOCOL_ID, PROTOCOL_VERSION, TOKEN_BYTES, generateToken } from './env.js';
import { ABSOLUTE_LIMITS, DEFAULT_LIMITS } from './limits.js';
import { MARKER_OSC_CODE, encodeMarker, verifyMarkerPayload } from './marker.js';

/**
 * The payload a VT parser would hand an OSC handler: everything after
 * `OSC <code>;`, terminator consumed. Derived from the constants rather than
 * from fixed offsets, so a future encoding change fails in `marker.test.ts`
 * where it belongs instead of here.
 */
function markerPayload(sequence: string): string {
  const opener = `\u001b]${MARKER_OSC_CODE};`;
  return sequence.slice(opener.length, -1);
}

describe('generateToken', () => {
  it('mints a 256-bit token as unpadded base64url', () => {
    const token = generateToken();
    expect(TOKEN_BYTES).toBe(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(TOKEN_BYTES);
  });

  it('is unpredictable across launches', () => {
    const tokens = new Set(Array.from({ length: 256 }, () => generateToken()));
    expect(tokens.size).toBe(256);
  });

  it('survives a trip through the environment unchanged', () => {
    // The contract is that the token is opaque: whatever reaches the env var is
    // exactly what both sides feed to the HMAC.
    const token = generateToken();
    process.env['TERMWRIGHT_TOKEN_TEST'] = token;
    const received = process.env['TERMWRIGHT_TOKEN_TEST']!;
    delete process.env['TERMWRIGHT_TOKEN_TEST'];

    expect(received).toBe(token);
    const payload = markerPayload(encodeMarker(received, 's1', 1));
    expect(verifyMarkerPayload(payload, token, 's1')).not.toBeNull();
  });

  it('is used as an opaque string, not decoded to bytes', () => {
    // Decoding the token before keying the HMAC yields a different MAC — the
    // mistake this test exists to catch.
    const token = generateToken();
    const payload = markerPayload(encodeMarker(token, 's1', 1));
    const decoded = Buffer.from(token, 'base64url').toString('binary');
    expect(verifyMarkerPayload(payload, decoded, 's1')).toBeNull();
  });
});

describe('protocol identity', () => {
  it('pins the version and id together', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(PROTOCOL_ID).toBe(`termwright/${PROTOCOL_VERSION}`);
  });
});

describe('limits (D4)', () => {
  it('gives a full tree room for provenance', () => {
    // At the measured 217.5 B/node a full maxNodes tree is ~1 062 KiB, so a
    // 1 MiB ceiling contradicted the node ceiling it shipped with.
    expect(DEFAULT_LIMITS.maxSnapshotBytes).toBe(2 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxNodes * 218).toBeLessThan(DEFAULT_LIMITS.maxSnapshotBytes);
  });

  it('leaves the absolute ceiling where it was', () => {
    expect(ABSOLUTE_LIMITS.maxSnapshotBytes).toBe(8 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxSnapshotBytes).toBeLessThan(ABSOLUTE_LIMITS.maxSnapshotBytes);
  });
});
