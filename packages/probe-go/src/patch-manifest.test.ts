import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readManifest } from './patches.js';

const scratchDirectories: string[] = [];

async function manifestDirectory(manifest: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-patch-manifest-'));
  scratchDirectories.push(directory);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return directory;
}

afterEach(async () => {
  await Promise.all(
    scratchDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const addedUnit = {
  path: 'zz_termwright_probe.go',
  source: 'add/zz_termwright_probe.go',
  sha256: `sha256:${'a'.repeat(64)}`,
};

const capabilityManifest = {
  schemaVersion: 2,
  framework: 'example.com/framework',
  frameworkVersion: 'v1.2.3',
  patchSetVersion: 1,
  capability: 'container-enumeration',
  versionRange: '>=v1.0.0 (advisory)',
  requiredSymbols: ['Grid.items'],
  degradesTo: 'opaque-container',
  patched: [],
  added: [addedUnit],
};

describe('patch intervention manifests', () => {
  it('keeps the current exact T3 byte contract valid without capability metadata', async () => {
    const directory = await manifestDirectory({
      framework: 'example.com/framework',
      frameworkVersion: 'v1.2.3',
      patchSetVersion: 1,
      patched: [],
      added: [],
    });

    await expect(readManifest(directory)).resolves.toMatchObject({
      framework: 'example.com/framework',
    });
  });

  it('accepts an add-only T1 contract verified by compilation and conformance', async () => {
    const directory = await manifestDirectory({
      ...capabilityManifest,
      tier: 'T1',
      verification: {
        method: 'toolexec-compile+behavioral-conformance',
        conformanceSuite: 'packages/probe-example/src/conformance.test.ts',
      },
    });

    await expect(readManifest(directory)).resolves.toMatchObject({
      tier: 'T1',
      capability: 'container-enumeration',
    });
  });

  it.each([
    ['schemaVersion 2', { schemaVersion: 1 }, /T1 manifests must declare schemaVersion 2/u],
    ['an explicit tier', { tier: undefined }, /metadata must declare a tier/u],
    ['add-only files', { patched: [{ path: 'widget.go' }] }, /T1 must be add-only/u],
  ])('rejects a T1 contract without %s', async (_name, override, expected) => {
    const manifest = {
      ...capabilityManifest,
      tier: 'T1',
      verification: {
        method: 'toolexec-compile+behavioral-conformance',
        conformanceSuite: 'packages/probe-example/src/conformance.test.ts',
      },
      ...override,
    };
    if ('tier' in override && override.tier === undefined)
      delete (manifest as { tier?: string }).tier;
    const directory = await manifestDirectory(manifest);

    await expect(readManifest(directory)).rejects.toThrow(expected);
  });

  it('requires idempotency in the T2 compiler and conformance contract', async () => {
    const valid = {
      ...capabilityManifest,
      tier: 'T2',
      verification: {
        method: 'append-idempotency+compile+behavioral-conformance',
        conformanceSuite: 'packages/probe-example/src/conformance.test.ts',
      },
    };
    const validDirectory = await manifestDirectory(valid);
    await expect(readManifest(validDirectory)).resolves.toMatchObject({ tier: 'T2' });

    const invalidDirectory = await manifestDirectory({
      ...valid,
      verification: { ...valid.verification, method: 'compile+behavioral-conformance' },
    });
    await expect(readManifest(invalidDirectory)).rejects.toThrow(/idempotency/u);
  });

  it('rejects unknown intervention tiers', async () => {
    const directory = await manifestDirectory({
      ...capabilityManifest,
      tier: 'T4',
      verification: {
        method: 'compile+behavioral-conformance',
        conformanceSuite: 'packages/probe-example/src/conformance.test.ts',
      },
    });

    await expect(readManifest(directory)).rejects.toThrow(/unknown intervention tier T4/u);
  });
});
