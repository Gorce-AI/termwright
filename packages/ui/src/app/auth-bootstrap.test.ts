import { describe, expect, it, vi } from 'vitest';
import { bootstrapRunnerToken } from './auth-bootstrap.js';

describe('runner credential bootstrap', () => {
  it('removes a supplied token from the address and keeps it only for this tab', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const replaceState = vi.fn();
    const token = bootstrapRunnerToken(
      new URL('http://127.0.0.1:3000/?token=capability&view=runner&executionId=e1'),
      storage,
      { state: null, replaceState },
    );
    expect(token).toBe('capability');
    const sanitized = replaceState.mock.calls[0]?.[2] as URL;
    expect(sanitized.searchParams.get('token')).toBeNull();
    expect(sanitized.searchParams.get('executionId')).toBe('e1');
    expect(JSON.stringify(replaceState.mock.calls[0]?.[0])).not.toContain('capability');
    expect(
      bootstrapRunnerToken(new URL('http://127.0.0.1:3000/?view=runner'), storage, {
        state: null,
        replaceState,
      }),
    ).toBe('capability');
  });
});
