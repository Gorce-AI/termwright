import { describe, expect, it } from 'vitest';
import {
  verifyCrateMetadata,
  verifyNpmMetadata,
  verifyPypiMetadata,
} from './verify-published-artifact.mjs';

describe('immutable registry retry verification', () => {
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
