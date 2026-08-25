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

  it('gives Windows the native backend or nothing, never a weaker substitute', async () => {
    // Both architectures Windows runs on ship a prebuild, so a machine that
    // cannot load one has a broken install rather than an unsupported
    // toolchain. Substituting node-pty there would hand the caller an output
    // boundary that looks identical and means something weaker, which is the
    // one failure a test can never catch afterwards.
    const attempt = resolveDefaultPtyBackend('win32');
    if (process.platform === 'win32') {
      await expect(attempt).resolves.toMatchObject({ backend: { name: CONPTY_BACKEND_NAME } });
      return;
    }
    // Elsewhere the addon genuinely cannot exist, and the refusal has to say
    // what it tried rather than only that it failed.
    await expect(attempt).rejects.toMatchObject({ code: 'pty-backend-failed' });
  });
});
