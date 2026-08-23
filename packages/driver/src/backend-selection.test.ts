import { afterEach, describe, expect, it } from 'vitest';
import { resetPtyBackendChoice, resolveDefaultPtyBackend } from './backend-selection.js';
import { CONPTY_BACKEND_NAME } from './conpty-backend.js';

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

  it('has nothing to choose off Windows, and says nothing', async () => {
    const choice = await resolveDefaultPtyBackend('darwin');
    expect(choice.backend.name).not.toBe(CONPTY_BACKEND_NAME);
    // No complaint, because there is no better option being passed over.
    expect(choice.degradedReason).toBeUndefined();
  });

  it('answers the same object twice rather than probing again', async () => {
    const first = await resolveDefaultPtyBackend('linux');
    const second = await resolveDefaultPtyBackend('linux');
    expect(second).toBe(first);
  });

  it('names the weaker guarantee when Windows falls back', async () => {
    const choice = await resolveDefaultPtyBackend('win32');
    if (choice.backend.name === CONPTY_BACKEND_NAME) {
      // A machine with the addon built. Nothing was given up, so nothing is
      // reported — asserting a reason here would demand a complaint that
      // would be false.
      expect(choice.degradedReason).toBeUndefined();
      return;
    }
    // Everywhere else the fallback has to account for itself, and the part
    // that matters is which guarantee was lost, not which module was missing.
    expect(choice.degradedReason).toMatch(/bounded flush window rather than on the pipe/u);
  });
});
