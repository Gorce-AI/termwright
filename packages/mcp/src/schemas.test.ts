import { describe, expect, it } from 'vitest';
import { modesSchema } from './schemas.js';

/**
 * The mode enums are the one place where a platform difference reaches the
 * schema: on Windows the emulator cannot observe the mouse mode and the driver
 * reports `'unknown'`. macOS and Linux never produce that value, so without a
 * direct test the Windows path is exercised nowhere.
 */
describe('terminal modes', () => {
  const base = {
    mouseTracking: 'none',
    mouseEncoding: 'default',
    bracketedPaste: false,
    applicationCursorKeys: false,
    applicationKeypad: false,
    focusReporting: false,
    synchronizedOutput: false,
  };

  it('accepts an unobservable mouse mode, as ConPTY reports it', () => {
    const parsed = modesSchema.safeParse({
      ...base,
      mouseTracking: 'unknown',
      mouseEncoding: 'unknown',
    });
    expect(parsed.success).toBe(true);
  });

  it('still accepts every observable value', () => {
    for (const tracking of ['none', 'x10', 'vt200', 'drag', 'any']) {
      expect(modesSchema.safeParse({ ...base, mouseTracking: tracking }).success).toBe(true);
    }
    for (const encoding of ['default', 'sgr', 'urxvt', 'utf8']) {
      expect(modesSchema.safeParse({ ...base, mouseEncoding: encoding }).success).toBe(true);
    }
  });

  it('rejects a value the driver cannot produce', () => {
    expect(modesSchema.safeParse({ ...base, mouseTracking: 'maybe' }).success).toBe(false);
  });
});
