import { describe, expect, it } from 'vitest';
import { encodeFocus, encodeKeys, encodePaste, encodeText } from './keys.js';
import { TermwrightError } from './errors.js';

const NORMAL = { applicationCursorKeys: false, applicationKeypad: false };
const APPLICATION = { applicationCursorKeys: true, applicationKeypad: false };

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

  it('encodes a sequence of chords in order', () => {
    expect(text(encodeKeys('Control+K Control+U', NORMAL))).toBe('\x0b\x15');
  });

  it('rejects unknown key names with a typed error', () => {
    expect(() => encodeKeys('Bananas', NORMAL)).toThrow(TermwrightError);
    try {
      encodeKeys('Bananas', NORMAL);
    } catch (error) {
      expect((error as TermwrightError).code).toBe('unsupported-action');
      expect((error as TermwrightError).diagnostics.suggestion).toContain('Arrow{Up');
    }
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
