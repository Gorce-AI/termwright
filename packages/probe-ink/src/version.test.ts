import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PACKAGE_VERSION } from './version.js';
import { probeInfo } from './session.js';

describe('published version', () => {
  it('does not drift from the package manifest during a Changesets release', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { readonly version: string };
    expect(PACKAGE_VERSION).toBe(manifest.version);
    expect(probeInfo().probeVersion).toBe(manifest.version);
  });
});
