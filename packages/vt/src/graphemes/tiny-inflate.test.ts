import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import inflate from './tiny-inflate.js';

describe('the Unicode trie inflater boundary', () => {
  it('decodes a valid raw DEFLATE stream with bounded bit lookahead', () => {
    const expected = Buffer.from('termwright-grapheme-boundary'.repeat(8));
    const compressed = deflateRawSync(expected);
    expect([...inflate(compressed, new Uint8Array(expected.length))]).toEqual([...expected]);
  });

  it('rejects truncation instead of synthesizing an unbounded zero tail', () => {
    const expected = Buffer.from('termwright-grapheme-boundary'.repeat(64));
    const compressed = deflateRawSync(expected);
    expect(() =>
      inflate(
        compressed.subarray(0, Math.floor(compressed.length / 2)),
        new Uint8Array(expected.length),
      ),
    ).toThrow();
  });

  it('rejects a stream truncated by exactly its final byte', () => {
    const expected = Buffer.from('case-1-x');
    const compressed = deflateRawSync(expected);
    expect(() => inflate(compressed.subarray(0, -1), new Uint8Array(expected.length))).toThrow(
      /Truncated/u,
    );
  });

  it('rejects bytes after the final DEFLATE block', () => {
    const expected = Buffer.from('termwright-grapheme-boundary');
    const compressed = deflateRawSync(expected);
    const withGarbage = Buffer.concat([compressed, Buffer.from([0xde, 0xad])]);
    expect(() => inflate(withGarbage, new Uint8Array(expected.length))).toThrow(/Trailing/u);
  });

  it('rejects output larger than the declared destination', () => {
    const expected = Buffer.from('repeated-output'.repeat(64));
    expect(() => inflate(deflateRawSync(expected), new Uint8Array(8))).toThrow(
      /output size|back-reference/u,
    );
  });
});
