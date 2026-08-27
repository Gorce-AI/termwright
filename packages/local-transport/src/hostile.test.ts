import { describe, expect, it } from 'vitest';
import { LocalJsonDecoder, LocalTransportError } from './index.js';

function header(length: number): Uint8Array {
  return new Uint8Array([
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ]);
}

function framedBody(body: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + body.length);
  frame.set(header(body.length), 0);
  frame.set(body, 4);
  return frame;
}

function code(operation: () => void): string {
  try {
    operation();
  } catch (error) {
    return error instanceof LocalTransportError ? error.code : `unexpected:${String(error)}`;
  }
  return 'no-throw';
}

describe('shared hostile local framing', () => {
  it('rejects a 4 GiB claim from the header and poisons the decoder', () => {
    const decoder = new LocalJsonDecoder(64 * 1024, () => undefined);
    expect(code(() => decoder.push(header(0xffff_ffff)))).toBe('frame-oversized');
    expect(decoder.buffered).toBe(0);
    expect(code(() => decoder.push(framedBody(new TextEncoder().encode('{}'))))).toBe(
      'frame-malformed',
    );
  });

  it('uses fatal UTF-8 decoding rather than replacement characters', () => {
    const decoder = new LocalJsonDecoder(1024, () => undefined);
    expect(code(() => decoder.push(framedBody(new Uint8Array([0x22, 0xff, 0x22]))))).toBe(
      'frame-encoding',
    );
  });

  it('bounds a partial frame before allocating an attacker-declared body', () => {
    const ceiling = 256 * 1024;
    const decoder = new LocalJsonDecoder(ceiling, () => undefined);
    decoder.push(header(ceiling));
    const chunk = new Uint8Array(32 * 1024);
    for (let index = 0; index < 7; index += 1) {
      decoder.push(chunk);
      expect(decoder.buffered).toBeLessThanOrEqual(ceiling + 4);
    }
  });

  it('rejects an oversized prefix without copying the rest of a 128 MiB socket chunk', () => {
    const decoder = new LocalJsonDecoder(64 * 1024, () => undefined);
    const chunk = new Uint8Array(128 * 1024 * 1024);
    chunk.set(header(0xffff_ffff));
    expect(code(() => decoder.push(chunk))).toBe('frame-oversized');
    expect(decoder.buffered).toBe(0);
  });

  it('still accepts a coalesced chunk containing more than one frame budget', () => {
    const messages: unknown[] = [];
    const decoder = new LocalJsonDecoder(64, (message) => messages.push(message));
    const frames = Array.from({ length: 100 }, (_, index) =>
      framedBody(new TextEncoder().encode(JSON.stringify({ index }))),
    );
    const length = frames.reduce((sum, frame) => sum + frame.length, 0);
    const chunk = new Uint8Array(length);
    let offset = 0;
    for (const frame of frames) {
      chunk.set(frame, offset);
      offset += frame.length;
    }
    decoder.push(chunk);
    expect(messages).toHaveLength(100);
    expect(messages.at(-1)).toEqual({ index: 99 });
    expect(decoder.buffered).toBe(0);
  });

  it('rejects prototype-bearing JSON at the shared DTO boundary', () => {
    const decoder = new LocalJsonDecoder(1024, () => undefined);
    expect(
      code(() =>
        decoder.push(framedBody(new TextEncoder().encode('{"__proto__":{"polluted":true}}'))),
      ),
    ).toBe('frame-malformed');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
