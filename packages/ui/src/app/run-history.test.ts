import { describe, expect, it } from 'vitest';
import { formatWhen } from './run-history.js';

describe('formatWhen', () => {
  const now = Date.parse('2026-08-16T15:00:00');

  it('says today and yesterday rather than making you read a date', () => {
    expect(formatWhen(Date.parse('2026-08-16T09:04:00'), now)).toMatch(/^today /);
    expect(formatWhen(Date.parse('2026-08-15T09:04:00'), now)).toMatch(/^yesterday /);
  });

  it('falls back to a date for anything older', () => {
    const older = formatWhen(Date.parse('2026-08-12T09:04:00'), now);
    expect(older).not.toMatch(/today|yesterday/);
    expect(older).toMatch(/12/);
  });
});
