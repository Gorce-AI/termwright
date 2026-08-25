import { describe, expect, it, vi } from 'vitest';
import { ensureTestHost } from './ensure-test-host.mjs';

function missing() {
  return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

describe('fresh-checkout test host preparation', () => {
  it('does nothing when the compiled host already exists', async () => {
    const build = vi.fn();
    await expect(ensureTestHost({ accessFile: async () => {}, build, verify: async () => [] })).resolves.toBe(false);
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

    await expect(ensureTestHost({ accessFile, build, verify: async () => [] })).resolves.toBe(true);
    expect(build).toHaveBeenCalledOnce();
    expect(accessFile).toHaveBeenCalledTimes(2);
  });

  it('does not treat permission and I/O failures as a missing build', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
    const build = vi.fn();
    await expect(ensureTestHost({
      accessFile: async () => { throw denied; },
      build,
      verify: async () => [],
    })).rejects.toBe(denied);
    expect(build).not.toHaveBeenCalled();
  });

  it('rebuilds an existing host when its source or artifact fingerprint is stale', async () => {
    let fresh = false;
    const build = vi.fn(async () => { fresh = true; });
    const verify = vi.fn(async () => fresh ? [] : ['workspace build sources changed']);

    await expect(ensureTestHost({ accessFile: async () => {}, build, verify })).resolves.toBe(true);
    expect(build).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['malformed JSON', new SyntaxError('Unexpected token')],
    ['unsupported schema', new Error('unsupported immutable build manifest /tmp/manifest.json')],
    [
      'a declared artifact removed by an interrupted clean build',
      new Error('declared production artifact is missing: /tmp/packages/fixture/dist/index.js'),
    ],
  ])('self-heals a generated manifest with %s', async (_label, initialError) => {
    let built = false;
    const build = vi.fn(async () => { built = true; });
    const verify = vi.fn(async () => {
      if (!built) throw initialError;
      return [];
    });

    await expect(ensureTestHost({ accessFile: async () => {}, build, verify })).resolves.toBe(true);
    expect(build).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a declared production artifact is still missing after rebuild', async () => {
    const missingArtifact = new Error(
      'declared production artifact is missing: /tmp/packages/fixture/dist/index.js',
    );
    const build = vi.fn(async () => undefined);
    const verify = vi.fn()
      .mockRejectedValueOnce(missingArtifact)
      .mockRejectedValueOnce(missingArtifact);

    await expect(ensureTestHost({ accessFile: async () => {}, build, verify }))
      .rejects.toThrow(/workspace build completed without a readable supported immutable manifest/u);
    expect(build).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a build does not refresh its manifest', async () => {
    await expect(ensureTestHost({
      accessFile: async () => {},
      build: async () => undefined,
      verify: async () => ['artifact changed after the build'],
    })).rejects.toThrow(/completed without a fresh immutable manifest.*artifact changed/u);
  });

  it('fails closed when rebuild leaves a malformed generated manifest', async () => {
    await expect(ensureTestHost({
      accessFile: async () => {},
      build: async () => undefined,
      verify: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    })).rejects.toThrow(/completed without a readable supported immutable manifest/u);
  });
});
