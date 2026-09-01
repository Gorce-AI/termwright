import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { UnicodeTrie } from './unicode-trie.js';

function encodedTrie(options: { readonly declaredLength?: number } = {}): Uint8Array {
  const words = new Uint32Array([7, 7, 7, 7]);
  const raw = new Uint8Array(words.buffer);
  const compressed = deflateRawSync(deflateRawSync(raw));
  const payload = new Uint8Array(12 + compressed.byteLength);
  const header = new DataView(payload.buffer);
  header.setUint32(0, 0, true);
  header.setUint32(4, 99, true);
  header.setUint32(8, options.declaredLength ?? raw.byteLength, true);
  payload.set(compressed, 12);
  return payload;
}

describe('the owned Unicode trie boundary', () => {
  it('respects a pooled Buffer view offset and length', () => {
    const payload = encodedTrie();
    const pool = Buffer.alloc(payload.byteLength + 37, 0xa5);
    pool.set(payload, 19);
    const view = new Uint8Array(pool.buffer, pool.byteOffset + 19, payload.byteLength);
    expect(new UnicodeTrie(view).get(0x1f_469)).toBe(7);
  });

  it('rejects truncated headers and payloads', () => {
    expect(() => new UnicodeTrie(new Uint8Array(11))).toThrow(/header/u);
    const payload = encodedTrie();
    expect(() => new UnicodeTrie(payload.subarray(0, payload.byteLength - 5))).toThrow();
  });

  it('rejects impossible or unaligned declared dimensions', () => {
    expect(() => new UnicodeTrie(encodedTrie({ declaredLength: 15 }))).toThrow(/dimensions/u);
    expect(() => new UnicodeTrie(encodedTrie({ declaredLength: 0x20_0000 }))).toThrow(
      /dimensions/u,
    );
  });
});
