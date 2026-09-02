import { describe, expect, it } from 'vitest';
import { createFrameDecoder, encodeFrame, framedByteLength, projectDto } from './framing.js';
import { ProtocolViolation } from './errors.js';

const MAX = 4096;

function frame(value: unknown, max = MAX): Uint8Array {
  return encodeFrame(value, max);
}

function violationCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProtocolViolation) return error.code;
    return `unexpected:${String(error)}`;
  }
  return 'no-throw';
}

/** A frame header declaring `length` bytes of body. */
function header(length: number): Uint8Array {
  return new Uint8Array([
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ]);
}

describe('encodeFrame', () => {
  it('writes a 4-byte big-endian length prefix followed by UTF-8 JSON', () => {
    const encoded = frame({ type: 'ping' });
    const body = new TextDecoder().decode(encoded.subarray(4));
    expect(body).toBe('{"type":"ping"}');
    expect(encoded.subarray(0, 4)).toEqual(header(body.length));
  });

  it('counts bytes, not characters, against the ceiling', () => {
    // '€' is 3 UTF-8 bytes; 10 of them plus quotes = 32 bytes.
    const value = '€'.repeat(10);
    expect(() => frame(value, 32)).not.toThrow();
    expect(violationCode(() => frame(value, 31))).toBe('frame-oversized');
  });

  it('rejects values that do not serialise to JSON', () => {
    expect(violationCode(() => frame(undefined))).toBe('dto-scalar');
    expect(violationCode(() => frame({ n: 1n }))).toBe('frame-malformed');
  });

  it('rejects a non-positive ceiling', () => {
    expect(violationCode(() => frame({}, 0))).toBe('frame-malformed');
    expect(violationCode(() => frame({}, 1.5))).toBe('frame-malformed');
  });
});

describe('createFrameDecoder', () => {
  it('round-trips a single frame', () => {
    const decoder = createFrameDecoder(MAX);
    expect(decoder.push(frame({ type: 'hello', n: 1 }))).toEqual([{ type: 'hello', n: 1 }]);
    expect(decoder.buffered).toBe(0);
  });

  it('returns several frames delivered in one chunk', () => {
    const decoder = createFrameDecoder(MAX);
    const a = frame({ i: 1 });
    const b = frame({ i: 2 });
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0);
    joined.set(b, a.length);
    expect(decoder.push(joined)).toEqual([{ i: 1 }, { i: 2 }]);
  });

  it('holds a partial frame without emitting it, byte by byte', () => {
    const decoder = createFrameDecoder(MAX);
    const encoded = frame({ hello: 'world' });
    for (let i = 0; i < encoded.length - 1; i += 1) {
      expect(decoder.push(encoded.subarray(i, i + 1))).toEqual([]);
    }
    expect(decoder.buffered).toBe(encoded.length - 1);
    expect(decoder.push(encoded.subarray(encoded.length - 1))).toEqual([{ hello: 'world' }]);
    expect(decoder.buffered).toBe(0);
  });

  it('rejects an oversized frame from the header alone, before reading a body', () => {
    const decoder = createFrameDecoder(64);
    // Only the header is supplied: the body never arrives, yet this must fail.
    expect(violationCode(() => decoder.push(header(1_000_000))).valueOf()).toBe('frame-oversized');
  });

  it('rejects a zero-length frame', () => {
    const decoder = createFrameDecoder(MAX);
    expect(violationCode(() => decoder.push(header(0)))).toBe('frame-malformed');
  });

  it('stays poisoned after a violation instead of resynchronising', () => {
    const decoder = createFrameDecoder(64);
    expect(violationCode(() => decoder.push(header(999_999)))).toBe('frame-oversized');
    expect(violationCode(() => decoder.push(frame({ ok: true }, 64)))).toBe('decoder-poisoned');
    expect(decoder.buffered).toBe(0);
  });

  it('rejects a body that is not well-formed UTF-8', () => {
    const decoder = createFrameDecoder(MAX);
    const body = new Uint8Array([0x22, 0xff, 0xfe, 0x22]); // "\xff\xfe"
    const chunk = new Uint8Array(4 + body.length);
    chunk.set(header(body.length), 0);
    chunk.set(body, 4);
    expect(violationCode(() => decoder.push(chunk))).toBe('frame-encoding');
  });

  it('rejects a body that is not JSON', () => {
    const decoder = createFrameDecoder(MAX);
    const body = new TextEncoder().encode('{not json');
    const chunk = new Uint8Array(4 + body.length);
    chunk.set(header(body.length), 0);
    chunk.set(body, 4);
    expect(violationCode(() => decoder.push(chunk))).toBe('frame-malformed');
  });

  it('rejects a __proto__ payload rather than decoding it', () => {
    const decoder = createFrameDecoder(MAX);
    const body = new TextEncoder().encode('{"__proto__":{"polluted":true}}');
    const chunk = new Uint8Array(4 + body.length);
    chunk.set(header(body.length), 0);
    chunk.set(body, 4);
    expect(violationCode(() => decoder.push(chunk))).toBe('dto-key');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('freezes decoded messages', () => {
    const decoder = createFrameDecoder(MAX);
    const [message] = decoder.push(frame({ nested: { deep: [1, 2] } })) as [
      { nested: { deep: number[] } },
    ];
    expect(Object.isFrozen(message)).toBe(true);
    expect(Object.isFrozen(message.nested)).toBe(true);
    expect(Object.isFrozen(message.nested.deep)).toBe(true);
  });

  it('retains the authoritative wire-body byte length on the owned DTO', () => {
    const encoded = frame({ text: '€', nested: { ok: true } });
    const [message] = createFrameDecoder(MAX).push(encoded);
    expect(framedByteLength(message)).toBe(encoded.byteLength - 4);
  });
});

describe('projectDto', () => {
  it('copies plain JSON structures and freezes every level', () => {
    const input = { a: [1, 'two', null, { b: true }] };
    const output = projectDto<typeof input>(input, 8);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(Object.isFrozen(output.a[3])).toBe(true);
  });

  it('returns an already-owned DTO by identity instead of projecting it twice', () => {
    const owned = projectDto({ nested: { value: 1 } }, 8);
    expect(projectDto(owned, 8)).toBe(owned);
  });

  it('rejects accessors without invoking them', () => {
    let invoked = false;
    const hostile = Object.defineProperty({}, 'trap', {
      enumerable: true,
      configurable: true,
      get() {
        invoked = true;
        return 'boom';
      },
    });
    expect(violationCode(() => projectDto(hostile, 8))).toBe('dto-accessor');
    expect(invoked).toBe(false);
  });

  it('rejects an accessor that throws, still without invoking it', () => {
    const hostile = {
      get explode(): never {
        throw new Error('should never run');
      },
    };
    expect(violationCode(() => projectDto(hostile, 8))).toBe('dto-accessor');
  });

  it('rejects cycles', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(violationCode(() => projectDto(cyclic, 8))).toBe('dto-alias');
  });

  it('rejects aliases (the same object reachable twice)', () => {
    const shared = { shared: true };
    expect(violationCode(() => projectDto({ a: shared, b: shared }, 8))).toBe('dto-alias');
  });

  it('rejects sparse arrays', () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3];
    expect(violationCode(() => projectDto(sparse, 8))).toBe('dto-sparse');
  });

  it('rejects arrays carrying extra own properties', () => {
    const decorated: unknown[] = [1, 2];
    (decorated as unknown as Record<string, unknown>)['extra'] = 'x';
    expect(violationCode(() => projectDto(decorated, 8))).toBe('dto-sparse');
  });

  it('rejects proxies', () => {
    const proxied = new Proxy({ a: 1 }, {});
    expect(violationCode(() => projectDto(proxied, 8))).toBe('dto-prototype');
  });

  it('rejects exotic prototypes', () => {
    class Widget {
      readonly a = 1;
    }
    expect(violationCode(() => projectDto(new Widget(), 8))).toBe('dto-prototype');
    expect(violationCode(() => projectDto(new Date(), 8))).toBe('dto-prototype');
    expect(violationCode(() => projectDto(new Map(), 8))).toBe('dto-prototype');
  });

  it('accepts a null-prototype object', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['a'] = 1;
    expect(projectDto<{ a: number }>(bare, 8)).toEqual({ a: 1 });
  });

  it('rejects symbol keys', () => {
    const withSymbol = { [Symbol('s')]: 1, ok: 2 };
    expect(violationCode(() => projectDto(withSymbol, 8))).toBe('dto-symbol');
  });

  it('rejects non-JSON scalars', () => {
    expect(violationCode(() => projectDto({ n: Number.NaN }, 8))).toBe('dto-scalar');
    expect(violationCode(() => projectDto({ n: Infinity }, 8))).toBe('dto-scalar');
    expect(violationCode(() => projectDto({ n: undefined }, 8))).toBe('dto-scalar');
    expect(violationCode(() => projectDto({ n: 1n }, 8))).toBe('dto-scalar');
    expect(violationCode(() => projectDto({ n: () => 1 }, 8))).toBe('dto-scalar');
  });

  it('rejects unpaired surrogates in values and in keys', () => {
    expect(violationCode(() => projectDto({ s: '\uD800' }, 8))).toBe('dto-string');
    expect(violationCode(() => projectDto({ s: 'a\uDC00b' }, 8))).toBe('dto-string');
    expect(violationCode(() => projectDto({ ['\uD800']: 1 }, 8))).toBe('dto-string');
  });

  it('accepts well-formed astral characters', () => {
    expect(projectDto<{ s: string }>({ s: '👍🏽 żółć' }, 8).s).toBe('👍🏽 żółć');
  });

  it('rejects non-enumerable properties', () => {
    const hidden = Object.defineProperty({ visible: 1 }, 'sneaky', {
      enumerable: false,
      value: 2,
    });
    expect(violationCode(() => projectDto(hidden, 8))).toBe('dto-key');
  });

  it('enforces the depth ceiling', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 12; i += 1) deep = { deep };
    expect(violationCode(() => projectDto(deep, 4))).toBe('dto-depth');
    expect(() => projectDto(deep, 64)).not.toThrow();
  });

  it('rejects a negative or fractional depth ceiling', () => {
    expect(violationCode(() => projectDto({}, -1))).toBe('dto-depth');
    expect(violationCode(() => projectDto({}, 1.5))).toBe('dto-depth');
  });
});
