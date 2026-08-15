import { describe, expect, it } from 'vitest';
import { PROTOCOL_ID, PROTOCOL_VERSION, TOKEN_BYTES, generateToken } from './env.js';
import { encodeMarker, verifyMarkerPayload } from './marker.js';

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
    const payload = encodeMarker(received, 's1', 1).slice(2, -2);
    expect(verifyMarkerPayload(payload, token, 's1')).not.toBeNull();
  });

  it('is used as an opaque string, not decoded to bytes', () => {
    // Decoding the token before keying the HMAC yields a different MAC — the
    // mistake this test exists to catch.
    const token = generateToken();
    const payload = encodeMarker(token, 's1', 1).slice(2, -2);
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
