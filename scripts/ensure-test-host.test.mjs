import { describe, expect, it, vi } from 'vitest';
import { ensureTestHost } from './ensure-test-host.mjs';

function missing() {
  return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

describe('fresh-checkout test host preparation', () => {
  it('does nothing when the compiled host already exists', async () => {
    const build = vi.fn();
    await expect(ensureTestHost({ accessFile: async () => {}, build })).resolves.toBe(false);
    expect(build).not.toHaveBeenCalled();
  });

  it('builds the host dependency closure when the entrypoint is absent', async () => {
    let built = false;
    const build = vi.fn(async () => {
      built = true;
    });
    const accessFile = vi.fn(async () => {
      if (!built) throw missing();
    });

    await expect(ensureTestHost({ accessFile, build })).resolves.toBe(true);
    expect(build).toHaveBeenCalledOnce();
    expect(accessFile).toHaveBeenCalledTimes(2);
  });

  it('does not treat permission and I/O failures as a missing build', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
    const build = vi.fn();
    await expect(ensureTestHost({ accessFile: async () => { throw denied; }, build })).rejects.toBe(denied);
    expect(build).not.toHaveBeenCalled();
  });
});
