import { afterEach, describe, expect, it } from 'vitest';
import { resetPtyBackendChoice, resolveDefaultPtyBackend } from './backend-selection.js';
import { NATIVE_PTY_BACKEND_NAME } from './native-pty-backend.js';

/**
 * A session that silently ran on the weaker backend would still pass its
 * tests — right up to the one that depends on an end of output being real.
 * These pin that the choice is deliberate and that the fallback explains
 * itself rather than being indistinguishable from the real thing.
 */
describe('choosing a pseudo-terminal backend', () => {
  afterEach(() => {
    resetPtyBackendChoice();
  });

  it('selects the authoritative native backend off Windows', async () => {
    const choice = await resolveDefaultPtyBackend('darwin');
    expect(choice.backend.name).toBe(NATIVE_PTY_BACKEND_NAME);
    expect(choice.degradedReason).toBeUndefined();
  });

  it('answers the same object twice rather than probing again', async () => {
    const first = await resolveDefaultPtyBackend('linux');
    const second = await resolveDefaultPtyBackend('linux');
    expect(second).toBe(first);
  });

  it('gives Windows the same native backend rather than a platform fallback', async () => {
    const attempt = resolveDefaultPtyBackend('win32');
    await expect(attempt).resolves.toMatchObject({ backend: { name: NATIVE_PTY_BACKEND_NAME } });
  });
});
