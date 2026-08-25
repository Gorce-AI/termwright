import { describe, expect, it } from 'vitest';
import { encodeKeys } from '@termwright/driver/experimental';
import { coalesceInput, decodeInput, InputDecoder } from './input-decode.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const MODES = { applicationCursorKeys: false, applicationKeypad: false };

describe('decodeInput', () => {
  it('turns a printable run into one type action', () => {
    expect(decodeInput(encode('hello'))).toEqual([{ kind: 'type', text: 'hello' }]);
  });

  it('splits typing at control bytes', () => {
    expect(decodeInput(encode('hi\rthere'))).toEqual([
      { kind: 'type', text: 'hi' },
      { kind: 'press', keys: 'Enter' },
      { kind: 'type', text: 'there' },
    ]);
  });

  it('names control characters', () => {
    expect(decodeInput(encode('\x01'))).toEqual([{ kind: 'press', keys: 'Control+A' }]);
    expect(decodeInput(encode('\t'))).toEqual([{ kind: 'press', keys: 'Tab' }]);
    expect(decodeInput(encode('\x7f'))).toEqual([{ kind: 'press', keys: 'Backspace' }]);
  });

  it('decodes CSI and SS3 sequences', () => {
    expect(decodeInput(encode('\x1b[B'))).toEqual([{ kind: 'press', keys: 'ArrowDown' }]);
    expect(decodeInput(encode('\x1bOA'))).toEqual([{ kind: 'press', keys: 'ArrowUp' }]);
    expect(decodeInput(encode('\x1b[3~'))).toEqual([{ kind: 'press', keys: 'Delete' }]);
    expect(decodeInput(encode('\x1b[Z'))).toEqual([{ kind: 'press', keys: 'Shift+Tab' }]);
    expect(decodeInput(encode('\x1b[1;5C'))).toEqual([{ kind: 'press', keys: 'Control+ArrowRight' }]);
  });

  it('round-trips what the driver encodes', () => {
    for (const key of ['Enter', 'Escape', 'Tab', 'Backspace', 'ArrowUp', 'ArrowLeft', 'Home', 'End', 'PageUp', 'Delete', 'F5', 'F12', 'Control+C']) {
      expect(decodeInput(encodeKeys(key, MODES)), key).toEqual([{ kind: 'press', keys: key }]);
    }
  });

  it('reads a bracketed paste as one paste action', () => {
    expect(decodeInput(encode('\x1b[200~pasted text\x1b[201~'))).toEqual([
      { kind: 'paste', text: 'pasted text' },
    ]);
  });

  it('keeps unrecognised sequences as raw bytes instead of guessing', () => {
    const decoded = decodeInput(encode('\x1b[<0;1;1M'));
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.kind).toBe('raw');
  });
});

describe('InputDecoder streaming', () => {
  it('holds an escape sequence split across chunks', () => {
    const decoder = new InputDecoder();
    expect(decoder.push(encode('\x1b['))).toEqual([]);
    expect(decoder.push(encode('B'))).toEqual([{ kind: 'press', keys: 'ArrowDown' }]);
  });

  it('holds a multi-byte character split across chunks', () => {
    const bytes = encode('zażółć');
    const decoder = new InputDecoder();
    const first = decoder.push(bytes.subarray(0, 4));
    const second = decoder.push(bytes.subarray(4));
    const text = [...first, ...second]
      .map((input) => (input.kind === 'type' ? input.text : ''))
      .join('');
    expect(text).toBe('zażółć');
  });

  it('holds a paste terminator split across chunks', () => {
    const decoder = new InputDecoder();
    decoder.push(encode('\x1b[200~ab'));
    expect(decoder.push(encode('\x1b[20'))).toEqual([]);
    expect(decoder.push(encode('1~'))).toEqual([{ kind: 'paste', text: 'ab' }]);
  });

  it('flushes an unterminated paste rather than losing it', () => {
    const decoder = new InputDecoder();
    decoder.push(encode('\x1b[200~half'));
    expect(decoder.flush()).toEqual([{ kind: 'paste', text: 'half' }]);
  });
});

describe('coalesceInput', () => {
  it('merges neighbouring typing', () => {
    expect(
      coalesceInput([
        { kind: 'type', text: 'a' },
        { kind: 'type', text: 'b' },
        { kind: 'press', keys: 'Enter' },
        { kind: 'type', text: 'c' },
      ]),
    ).toEqual([
      { kind: 'type', text: 'ab' },
      { kind: 'press', keys: 'Enter' },
      { kind: 'type', text: 'c' },
    ]);
  });
});
