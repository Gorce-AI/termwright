/**
 * Mouse encoding, with the emphasis on the difference between a mode that is
 * known to be off and one the platform never let the driver see.
 */
import { describe, expect, it } from 'vitest';
import type { TerminalModes } from './api.js';
import { TermwrightError } from './errors.js';
import { encodeMouse, mouseModeUnverifiable } from './mouse.js';

function modes(overrides: Partial<TerminalModes> = {}): TerminalModes {
  return Object.freeze({
    mouseTracking: 'vt200',
    mouseEncoding: 'sgr',
    bracketedPaste: false,
    applicationCursorKeys: false,
    applicationKeypad: false,
    focusReporting: 'off',
    synchronizedOutput: false,
    ...overrides,
  });
}

function refusalFor(event: Parameters<typeof encodeMouse>[0], m: TerminalModes): TermwrightError {
  try {
    encodeMouse(event, m);
  } catch (cause) {
    return cause as TermwrightError;
  }
  throw new Error('expected encodeMouse to refuse');
}

const unknown = modes({ mouseTracking: 'unknown', mouseEncoding: 'unknown' });

describe('a mouse mode the platform hides', () => {
  it('is not the same as a mode known to be off', () => {
    expect(mouseModeUnverifiable(unknown)).toBe(true);
    expect(mouseModeUnverifiable(modes({ mouseTracking: 'none', mouseEncoding: 'default' }))).toBe(
      false,
    );
  });

  it('fails closed instead of guessing an SGR encoding', () => {
    const error = refusalFor({ kind: 'press', row: 2, column: 4, button: 'left' }, unknown);
    expect(error.code).toBe('input-mode-disabled');
    expect(error.message).toContain('not observable');
  });
});

describe('a mouse mode known to be off or limited', () => {
  it('still refuses when the child enabled nothing', () => {
    const error = refusalFor(
      { kind: 'press', row: 0, column: 0 },
      modes({ mouseTracking: 'none', mouseEncoding: 'default' }),
    );
    expect(error.code).toBe('input-mode-disabled');
    expect(error.message).toContain('has not enabled mouse tracking');
  });

  it('still refuses a release the level does not report', () => {
    const error = refusalFor(
      { kind: 'release', row: 0, column: 0 },
      modes({ mouseTracking: 'x10' }),
    );
    expect(error.code).toBe('input-mode-disabled');
  });

  it('still refuses motion the level does not report', () => {
    const error = refusalFor(
      { kind: 'move', row: 0, column: 0 },
      modes({ mouseTracking: 'vt200' }),
    );
    expect(error.code).toBe('input-mode-disabled');
    expect(error.diagnostics.suggestion).toContain('1002');
  });
});

describe('mouse modifiers', () => {
  it('encodes shift, alt and control in the terminal Cb bitfield', () => {
    const encoded = new TextDecoder().decode(
      encodeMouse(
        {
          kind: 'press',
          row: 2,
          column: 4,
          button: 'right',
          modifiers: ['control', 'shift', 'alt', 'shift'],
        },
        modes(),
      ),
    );
    expect(encoded).toBe('\x1b[<30;5;3M');
  });

  it('preserves modifier bits for release, motion and wheel reports', () => {
    expect(
      new TextDecoder().decode(
        encodeMouse(
          {
            kind: 'release',
            row: 0,
            column: 0,
            button: 'left',
            modifiers: ['control'],
          },
          modes(),
        ),
      ),
    ).toBe('\x1b[<16;1;1m');
    expect(
      new TextDecoder().decode(
        encodeMouse(
          {
            kind: 'move',
            row: 0,
            column: 0,
            modifiers: ['shift'],
          },
          modes({ mouseTracking: 'any' }),
        ),
      ),
    ).toBe('\x1b[<39;1;1M');
    expect(
      new TextDecoder().decode(
        encodeMouse(
          {
            kind: 'wheel',
            wheelDelta: 1,
            row: 0,
            column: 0,
            modifiers: ['alt'],
          },
          modes(),
        ),
      ),
    ).toBe('\x1b[<73;1;1M');
  });

  it('rejects unknown modifier names rather than dropping them', () => {
    expect(() =>
      encodeMouse(
        {
          kind: 'press',
          row: 0,
          column: 0,
          modifiers: ['super' as never],
        },
        modes(),
      ),
    ).toThrow(/unknown mouse modifier/u);
  });
});
