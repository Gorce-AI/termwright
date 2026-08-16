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

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

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

  it('sends the report in SGR rather than refusing', () => {
    // Measured, not assumed: a child whose DECSET ConPTY swallowed still
    // decodes this (see the mouse probe in escapes.pty.test.ts).
    expect(decode(encodeMouse({ kind: 'press', row: 2, column: 4, button: 'left' }, unknown))).toBe(
      '\x1b[<0;5;3M',
    );
    expect(
      decode(encodeMouse({ kind: 'release', row: 2, column: 4, button: 'right' }, unknown)),
    ).toBe('\x1b[<2;5;3m');
  });

  it('does not refuse events whose tracking level it cannot check', () => {
    // 'x10 has no release' and 'vt200 has no motion' are statements about a
    // level; under 'unknown' the level is exactly what is missing, so refusing
    // would deny input that works.
    expect(decode(encodeMouse({ kind: 'move', row: 0, column: 0, dragging: true }, unknown))).toBe(
      '\x1b[<35;1;1M',
    );
    expect(decode(encodeMouse({ kind: 'wheel', row: 1, column: 1, wheelDelta: 1 }, unknown))).toBe(
      '\x1b[<65;2;2M',
    );
  });

  it('escapes the legacy coordinate ceiling that would refuse a far cell', () => {
    // The default encoding cannot express past column 223; SGR can, and under
    // 'unknown' SGR is what gets sent.
    expect(decode(encodeMouse({ kind: 'press', row: 5, column: 400 }, unknown))).toBe(
      '\x1b[<0;401;6M',
    );
  });
});

describe('a mouse mode known to be off or limited', () => {
  it('still refuses when the child enabled nothing', () => {
    const error = refusalFor(
      { kind: 'press', row: 0, column: 0 },
      modes({ mouseTracking: 'none', mouseEncoding: 'default' }),
    );
    expect(error.code).toBe('unsupported-action');
    expect(error.message).toContain('has not enabled mouse tracking');
  });

  it('still refuses a release the level does not report', () => {
    const error = refusalFor({ kind: 'release', row: 0, column: 0 }, modes({ mouseTracking: 'x10' }));
    expect(error.code).toBe('unsupported-action');
  });

  it('still refuses motion the level does not report', () => {
    const error = refusalFor({ kind: 'move', row: 0, column: 0 }, modes({ mouseTracking: 'vt200' }));
    expect(error.code).toBe('unsupported-action');
    expect(error.diagnostics.suggestion).toContain('1002');
  });
});
