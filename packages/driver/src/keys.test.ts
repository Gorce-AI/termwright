import { describe, expect, it } from 'vitest';
import { encodeFocus, encodeKeys, encodePaste, encodeText } from './keys.js';

const NORMAL = { applicationCursorKeys: false, applicationKeypad: false };
const APPLICATION = { applicationCursorKeys: true, applicationKeypad: false };
const KITTY_DISAMBIGUATE = {
  applicationCursorKeys: false,
  applicationKeypad: false,
  kittyKeyboardFlags: 1,
};
const KITTY_ALL_WITH_TEXT = {
  applicationCursorKeys: false,
  applicationKeypad: false,
  kittyKeyboardFlags: 25,
};
const KITTY_ALL_ALTERNATE = {
  applicationCursorKeys: false,
  applicationKeypad: false,
  kittyKeyboardFlags: 13,
};

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('encodeKeys', () => {
  it('encodes plain characters and literal keys', () => {
    expect(text(encodeKeys('a', NORMAL))).toBe('a');
    expect(text(encodeKeys('Enter', NORMAL))).toBe('\r');
    expect(text(encodeKeys('Escape', NORMAL))).toBe('\x1b');
    expect(text(encodeKeys('Tab', NORMAL))).toBe('\t');
    expect(text(encodeKeys('Backspace', NORMAL))).toBe('\x7f');
    expect(text(encodeKeys('Space', NORMAL))).toBe(' ');
  });

  it('encodes control chords', () => {
    expect(text(encodeKeys('Control+A', NORMAL))).toBe('\x01');
    expect(text(encodeKeys('Control+c', NORMAL))).toBe('\x03');
    expect(text(encodeKeys('Control+[', NORMAL))).toBe('\x1b');
    expect(text(encodeKeys('Control+Space', NORMAL))).toBe('\x00');
  });

  it('uses lossless CSI-u input when the application enables kitty disambiguation', () => {
    expect(text(encodeKeys('Control+C', KITTY_DISAMBIGUATE))).toBe('\x1b[99;5u');
    expect(text(encodeKeys('Control+Shift+R', NORMAL))).toBe('\x1b[114;6u');
    expect(text(encodeKeys('Alt+[', KITTY_DISAMBIGUATE))).toBe('\x1b[91;3u');
    expect(text(encodeKeys('Escape', KITTY_DISAMBIGUATE))).toBe('\x1b[27u');
    expect(text(encodeKeys('Enter', KITTY_DISAMBIGUATE))).toBe('\r');
  });

  it('encodes alt as an ESC prefix and shift as upper case', () => {
    expect(text(encodeKeys('Alt+b', NORMAL))).toBe('\x1bb');
    expect(text(encodeKeys('Shift+b', NORMAL))).toBe('B');
    expect(text(encodeKeys('Shift+Tab', NORMAL))).toBe('\x1b[Z');
  });

  it('honors application cursor keys', () => {
    expect(text(encodeKeys('ArrowUp', NORMAL))).toBe('\x1b[A');
    expect(text(encodeKeys('ArrowUp', APPLICATION))).toBe('\x1bOA');
    expect(text(encodeKeys('Home', NORMAL))).toBe('\x1b[H');
    expect(text(encodeKeys('Home', APPLICATION))).toBe('\x1bOH');
  });

  it('adds the modifier parameter to cursor and tilde keys', () => {
    expect(text(encodeKeys('Control+ArrowRight', APPLICATION))).toBe('\x1b[1;5C');
    expect(text(encodeKeys('Shift+ArrowLeft', NORMAL))).toBe('\x1b[1;2D');
    expect(text(encodeKeys('Delete', NORMAL))).toBe('\x1b[3~');
    expect(text(encodeKeys('Control+PageUp', NORMAL))).toBe('\x1b[5;5~');
  });

  it('encodes function keys', () => {
    expect(text(encodeKeys('F1', NORMAL))).toBe('\x1bOP');
    expect(text(encodeKeys('F5', NORMAL))).toBe('\x1b[15~');
    expect(text(encodeKeys('F12', NORMAL))).toBe('\x1b[24~');
    expect(text(encodeKeys('Shift+F1', NORMAL))).toBe('\x1b[1;2P');
  });

  it('uses Kitty functional codes and alternate shifted keys when all keys are reported', () => {
    expect(text(encodeKeys('ArrowUp Shift+F1', KITTY_ALL_ALTERNATE))).toBe(
      '\x1b[57352u\x1b[57364;2u',
    );
    expect(text(encodeKeys('Shift+A', KITTY_ALL_ALTERNATE))).toBe('\x1b[97:65;2u');
  });

  it('encodes a sequence of chords in order', () => {
    expect(text(encodeKeys('Control+K Control+U', NORMAL))).toBe('\x0b\x15');
  });

  it('rejects unknown key names as invalid input', () => {
    expect(() => encodeKeys('Bananas', NORMAL)).toThrow(TypeError);
    expect(() => encodeKeys('Bananas', NORMAL)).toThrow(/Arrow\{Up/u);
  });
});

describe('encodeText', () => {
  it('translates newlines to carriage returns', () => {
    expect(text(encodeText('ab\ncd'))).toBe('ab\rcd');
    expect(text(encodeText('ab\r\ncd'))).toBe('ab\rcd');
  });

  it('passes Unicode through unchanged', () => {
    expect(text(encodeText('zażółć 😀'))).toBe('zażółć 😀');
  });

  it('reports all typed keys with associated text when requested', () => {
    expect(text(encodeText('Aa\n', KITTY_ALL_WITH_TEXT))).toBe(
      '\x1b[97;2;65u\x1b[97;1;97u\x1b[13u',
    );
  });
});

describe('encodePaste', () => {
  it('brackets the payload only when the child enabled bracketed paste', () => {
    expect(text(encodePaste('hi', true))).toBe('\x1b[200~hi\x1b[201~');
    expect(text(encodePaste('hi', false))).toBe('hi');
  });
});

describe('encodeFocus', () => {
  it('encodes focus in and out reports', () => {
    expect(text(encodeFocus(true))).toBe('\x1b[I');
    expect(text(encodeFocus(false))).toBe('\x1b[O');
  });
});
