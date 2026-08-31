import { describe, expect, it } from 'vitest';
import {
  encodeConPtyHostCursorResponse,
  parseConPtyHostCursorRequest,
  parseConPtyHostCursorResponse,
} from './conpty-host-rpc.js';

const token = '0123456789abcdef0123456789abcdef';

describe('the private ConPTY host cursor RPC', () => {
  it('round-trips one exact request-addressed reply', () => {
    const request = parseConPtyHostCursorRequest(`twh-cpr-v1:q:${token}`);
    expect(request).toEqual({ token });
    const encoded = encodeConPtyHostCursorResponse(request!, 3, 17);
    expect(parseConPtyHostCursorResponse(encoded)).toEqual({ token, row: 3, column: 17 });
  });

  it.each([
    `twh-cpr-v1:q:${token.toUpperCase()}`,
    `twh-cpr-v1:q:${token}0`,
    `twh-cpr-v1:r:${token}`,
    'twh-cpr-v2:q:0123456789abcdef0123456789abcdef',
  ])('rejects a non-canonical request payload: %s', (payload) => {
    expect(parseConPtyHostCursorRequest(payload)).toBeNull();
  });

  it('rejects unmatched, truncated, non-canonical and out-of-range replies', () => {
    expect(parseConPtyHostCursorResponse(`\x1b]8488;twh-cpr-v1:r:${token}:3:17`)).toBeNull();
    expect(parseConPtyHostCursorResponse(`\x1b]8488;twh-cpr-v1:r:${token}:03:17\x07`)).toBeNull();
    expect(
      parseConPtyHostCursorResponse(`\x1b]8488;twh-cpr-v1:r:${token}:32769:17\x07`),
    ).toBeNull();
    expect(parseConPtyHostCursorResponse(`\x1b]8487;twh-cpr-v1:r:${token}:3:17\x07`)).toBeNull();
  });
});
