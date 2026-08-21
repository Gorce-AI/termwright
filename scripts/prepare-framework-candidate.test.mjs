import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertArtifactSha256, preparePatchBundle, proposeCompatibilityUpdate, recordExecutableVariant } from './prepare-framework-candidate.mjs';

const sha = (value) => `sha256:${value.repeat(64)}`;

async function fixture(source = 'before\nanchor\nafter\n') {
  const rootDir = await mkdtemp(join(tmpdir(), 'tw-prepare-'));
  const template = join(rootDir, 'patches/example/2.0.0');
  const sourceRoot = join(rootDir, 'source');
  await mkdir(join(template, 'patches'), { recursive: true });
  await mkdir(join(template, 'add'), { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(sourceRoot, 'source.txt'), source);
  await writeFile(join(template, 'patches/source.patch'), '--- a/source.txt\n+++ b/source.txt\n@@ -1,3 +1,4 @@\n before\n anchor\n+injected\n after\n');
  await writeFile(join(template, 'add/version.txt'), 'framework=2.0.0\n');
  await writeFile(join(template, 'manifest.json'), JSON.stringify({ framework: 'example', frameworkVersion: '2.0.0', patchSetVersion: 9, patched: [{ path: 'source.txt', patch: 'patches/source.patch', sha256Before: sha('a'), sha256After: sha('b') }], added: [{ path: 'version.txt', source: 'add/version.txt', sha256: sha('c') }] }));
  const candidate = { id: 'example@2.0.1', mode: 'patch', version: '2.0.1', candidateDigest: sha('d'), patch: { status: 'needs-patch', path: 'patches/example/2.0.1/manifest.json' } };
  return { rootDir, sourceRoot, candidate };
}

describe('framework candidate patch preparation', () => {
  it('rejects a registry archive before extraction when its checksum differs', () => {
    expect(() => assertArtifactSha256(Buffer.from('archive'), '0'.repeat(64), 'crate@1.0.0')).toThrow(/downloaded archive hashes/u);
  });
  it('replays an audited transform reproducibly and binds it to revision and source', async () => {
    const one = await fixture();
    const two = await fixture();
    const first = await preparePatchBundle({ ...one, outputDirectory: join(one.rootDir, 'out'), sourceRevision: 'abcdef123' });
    const second = await preparePatchBundle({ ...two, outputDirectory: join(two.rootDir, 'out'), sourceRevision: 'abcdef123' });
    expect(first.metadata.patchTreeDigest).toBe(second.metadata.patchTreeDigest);
    expect(first.metadata).toMatchObject({ candidateId: 'example@2.0.1', sourceRevision: 'abcdef123', targetPath: 'patches/example/2.0.1' });
    expect(await readFile(join(first.destination, 'add/version.txt'), 'utf8')).toBe('framework=2.0.1\n');
    expect(first.manifest.patchSetVersion).toBe(9);
  });

  it('fails closed when upstream changed the audited anchor', async () => {
    const setup = await fixture('before\nchanged\nafter\n');
    await expect(preparePatchBundle({ ...setup, outputDirectory: join(setup.rootDir, 'out'), sourceRevision: 'abcdef123' })).rejects.toThrow(/no longer applies/u);
  });

  it('rejects artifact path traversal before copying or patching', async () => {
    const setup = await fixture();
    setup.candidate.patch.path = '../outside/manifest.json';
    await expect(preparePatchBundle({ ...setup, outputDirectory: join(setup.rootDir, 'out'), sourceRevision: 'abcdef123' })).rejects.toThrow(/normalized relative path/u);
  });

  it('separates exact patch declarations from behaviorally certified executable variants', () => {
    let registry = {
      frameworks: [{
        id: 'charm', frameworkPackage: 'charm.land/bubbletea/v2',
        versions: { policy: 'exact', declared: 'v2.1.0', verified: ['v2.1.0'] },
        instrumentation: {
          patchSets: [
            { name: 'charm.land/bubbletea/v2', version: 'v2.1.0', patchSetVersion: 1 },
            { name: 'charm.land/bubbles/v2', version: 'v2.1.0', patchSetVersion: 1 },
          ],
          variants: [{ id: 'old', frameworkVersion: 'v2.1.0', modules: [
            { name: 'charm.land/bubbletea/v2', version: 'v2.1.0' },
            { name: 'charm.land/bubbles/v2', version: 'v2.1.0', optional: true },
          ] }],
        },
      }],
    };
    const candidate = { id: 'bubbletea-v2@v2.1.1', frameworkId: 'charm', package: 'charm.land/bubbletea/v2', version: 'v2.1.1' };
    registry = proposeCompatibilityUpdate(registry, candidate, { patchSetVersion: 2 });
    expect(registry.frameworks[0].instrumentation.patchSets).toContainEqual({ name: candidate.package, version: 'v2.1.1', patchSetVersion: 2 });
    expect(registry.frameworks[0].instrumentation.variants).toHaveLength(1);

    registry = recordExecutableVariant(registry, candidate, { frameworkVersion: 'v2.1.1', modules: [
      { name: candidate.package, version: 'v2.1.1' },
      { name: 'charm.land/bubbles/v2', version: 'v2.1.0', optional: true },
    ] });
    expect(registry.frameworks[0].instrumentation.variants).toHaveLength(2);
    expect(registry.frameworks[0].instrumentation.variants.at(-1).modules.filter((module) => module.name === candidate.package)).toHaveLength(1);
  });

  it('keeps 2.1, 2.1.1, 2.2 and a late 2.1.2 as distinct exact variants without a false cross-product', () => {
    let registry = { frameworks: [{ id: 'example', frameworkPackage: 'example/core', versions: { policy: 'exact', declared: '2.1', verified: ['2.1'] }, instrumentation: { patchSets: [], variants: [] } }] };
    for (const version of ['2.1', '2.1.1', '2.2', '2.1.2']) {
      const candidate = { id: `example@${version}`, frameworkId: 'example', package: 'example/core', version };
      registry = proposeCompatibilityUpdate(registry, candidate, { patchSetVersion: 1 });
      registry = recordExecutableVariant(registry, candidate, { frameworkVersion: version, modules: [{ name: 'example/core', version }] });
    }
    expect(registry.frameworks[0].instrumentation.variants.map((variant) => variant.frameworkVersion).sort())
      .toEqual(['2.1', '2.1.1', '2.1.2', '2.2']);
    expect(registry.frameworks[0].instrumentation.variants.every((variant) => variant.modules.length === 1)).toBe(true);
  });
});
