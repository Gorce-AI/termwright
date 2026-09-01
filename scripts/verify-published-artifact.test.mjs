import { describe, expect, it, vi } from 'vitest';
import {
  fetchPypiMetadata,
  verifyCrateMetadata,
  verifyNpmMetadata,
  verifyNpmTagMetadata,
  verifyPypiMetadata,
} from './verify-published-artifact.mjs';

describe('immutable registry retry verification', () => {
  it('isolates every PyPI metadata read from cached pre-publication responses', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 404 }));

    await expect(fetchPypiMetadata('1.0.0', { fetchImpl })).resolves.toBeNull();
    await expect(fetchPypiMetadata('1.0.0', { fetchImpl })).resolves.toBeNull();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [firstUrl, firstOptions] = fetchImpl.mock.calls[0];
    const [secondUrl, secondOptions] = fetchImpl.mock.calls[1];
    expect(new URL(firstUrl).origin + new URL(firstUrl).pathname).toBe(
      'https://pypi.org/pypi/termwright/1.0.0/json',
    );
    expect(new URL(firstUrl).searchParams.get('termwright_verify')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(new URL(secondUrl).searchParams.get('termwright_verify')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(firstUrl).not.toBe(secondUrl);
    for (const options of [firstOptions, secondOptions]) {
      expect(options.headers).toMatchObject({
        'cache-control': 'no-cache, no-store, max-age=0',
        pragma: 'no-cache',
      });
    }
  });

  it('accepts only the exact npm integrity', () => {
    const expected = { name: '@termwright/driver', version: '1.0.0', integrity: 'sha512-exact' };
    expect(() =>
      verifyNpmMetadata(
        { name: expected.name, version: expected.version, dist: { integrity: expected.integrity } },
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      verifyNpmMetadata(
        { name: expected.name, version: expected.version, dist: { integrity: 'sha512-other' } },
        expected,
      ),
    ).toThrow(/different immutable content/u);
  });

  it('distinguishes an exact npm dist-tag from missing and different targets', () => {
    const expected = { tag: 'latest', version: '0.3.0' };
    expect(verifyNpmTagMetadata({ 'dist-tags': { latest: '0.3.0' } }, expected)).toBe('exact');
    expect(
      verifyNpmTagMetadata({ 'dist-tags': { bootstrap: '0.0.0-bootstrap.0' } }, expected),
    ).toBe('missing');
    expect(verifyNpmTagMetadata({ 'dist-tags': { latest: '0.0.0-bootstrap.0' } }, expected)).toBe(
      'different',
    );
  });

  it('rejects a partial or changed PyPI file set', () => {
    const expected = new Map([
      ['termwright-1.0.0.whl', 'a'],
      ['termwright-1.0.0.tar.gz', 'b'],
    ]);
    expect(
      verifyPypiMetadata(
        {
          info: { version: '1.0.0' },
          urls: [...expected].map(([filename, sha256]) => ({ filename, digests: { sha256 } })),
        },
        expected,
        '1.0.0',
      ),
    ).toBe('exact');
    expect(
      verifyPypiMetadata(
        {
          info: { version: '1.0.0' },
          urls: [{ filename: 'termwright-1.0.0.whl', digests: { sha256: 'a' } }],
        },
        expected,
        '1.0.0',
      ),
    ).toBe('partial');
    expect(() =>
      verifyPypiMetadata(
        {
          info: { version: '1.0.0' },
          urls: [{ filename: 'termwright-1.0.0.whl', digests: { sha256: 'changed' } }],
        },
        expected,
        '1.0.0',
      ),
    ).toThrow(/different immutable/u);
  });

  it('accepts only the exact crates.io checksum', () => {
    const expected = { name: 'termwright-protocol', version: '1.0.0', checksum: 'a'.repeat(64) };
    expect(() =>
      verifyCrateMetadata(
        { version: { num: expected.version, checksum: expected.checksum } },
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      verifyCrateMetadata(
        { version: { num: expected.version, checksum: 'b'.repeat(64) } },
        expected,
      ),
    ).toThrow(/different immutable content/u);
  });
});
