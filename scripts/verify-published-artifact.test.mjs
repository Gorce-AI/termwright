import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  collectPypiDistributions,
  fetchPypiMetadata,
  selectPypiDistributionNames,
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

  it('compares PyPI distributions while validating publisher-generated attestations', async () => {
    const distributions = ['termwright-1.0.0-py3-none-any.whl', 'termwright-1.0.0.tar.gz'];
    expect(
      selectPypiDistributionNames([
        `${distributions[1]}.publish.attestation`,
        distributions[0],
        `${distributions[0]}.publish.attestation`,
        distributions[1],
      ]),
    ).toEqual(distributions);
    expect(() => selectPypiDistributionNames([...distributions, 'unknown.json'])).toThrow(
      /unexpected local PyPI release artifact/u,
    );
    expect(() =>
      selectPypiDistributionNames([...distributions, 'other.whl.publish.attestation']),
    ).toThrow(/orphan PyPI publish attestation/u);

    const directory = await mkdtemp(join(tmpdir(), 'termwright-pypi-verifier-'));
    try {
      const contents = new Map([
        [distributions[0], 'wheel'],
        [distributions[1], 'sdist'],
      ]);
      for (const [name, content] of contents) await writeFile(join(directory, name), content);

      const preflight = await collectPypiDistributions(directory);
      const expected = new Map(
        [...contents].map(([name, content]) => [
          name,
          createHash('sha256').update(content).digest('hex'),
        ]),
      );
      expect(preflight).toEqual(expected);

      for (const name of distributions)
        await writeFile(join(directory, `${name}.publish.attestation`), 'attestation');
      const postPublish = await collectPypiDistributions(directory);
      expect(postPublish).toEqual(expected);
      expect(
        verifyPypiMetadata(
          {
            info: { version: '1.0.0' },
            urls: [...postPublish].map(([filename, sha256]) => ({
              filename,
              digests: { sha256 },
            })),
          },
          postPublish,
          '1.0.0',
        ),
      ).toBe('exact');

      await writeFile(join(directory, 'unexpected.json'), '{}');
      await expect(collectPypiDistributions(directory)).rejects.toThrow(
        /unexpected local PyPI release artifact/u,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
