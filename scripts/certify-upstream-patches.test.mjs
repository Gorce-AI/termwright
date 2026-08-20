import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CertificationError,
  assertDeterministicRuns,
  certify,
  crossCheckDeclarations,
  discoverPatchSets,
  initializeFailureReport,
  loadDeclarations,
  provenance,
  sanitizeFailureMessage,
  validateManifestShape,
  validatePatchSetFiles,
} from './certify-upstream-patches.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporary() {
  const path = await mkdtemp(join(tmpdir(), 'tw-certifier-test-'));
  scratch.push(path);
  return path;
}

describe('upstream patch candidate declarations', () => {
  it('matches every current Go and Rust manifest to the compatibility declaration', async () => {
    const patchSets = await discoverPatchSets(root);
    const { declarations } = await loadDeclarations(root);
    const matched = crossCheckDeclarations(patchSets, declarations);

    expect(matched.map(({ manifest }) => `${manifest.framework}@${manifest.frameworkVersion}`))
      .toEqual([...declarations.keys()].sort());
    for (const candidate of matched) await expect(validatePatchSetFiles(candidate)).resolves.toBeDefined();
  });

  it('refuses a manifest whose patch-set version drifted from the declaration', async () => {
    const patchSets = await discoverPatchSets(root);
    const { declarations } = await loadDeclarations(root);
    const first = patchSets[0];
    const changed = { ...first, manifest: { ...first.manifest, patchSetVersion: first.manifest.patchSetVersion + 1 } };

    expect(() => crossCheckDeclarations([changed, ...patchSets.slice(1)], declarations))
      .toThrow(/declares patch-set/u);
  });
});

describe('fail-closed local artifacts', () => {
  it('refuses a changed add-only source before reaching a toolchain', async () => {
    const source = join(root, 'packages/probe-charm/upstream-patches/bubbles/v1.0.0');
    const directory = join(await temporary(), 'set');
    await cp(source, directory, { recursive: true });
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    await appendFile(join(directory, manifest.added[0].source), '\n// tampered\n');

    await expect(validatePatchSetFiles({ manifest, patchSetDir: directory }))
      .rejects.toThrow(/hashes .* expected/u);
  });

  it('rejects traversal, duplicate targets and malformed digests', () => {
    expect(() => validateManifestShape({
      framework: 'example.invalid/framework',
      frameworkVersion: 'v1.0.0',
      patchSetVersion: 1,
      patched: [{
        path: '../outside.go',
        patch: 'patches/file.patch',
        sha256Before: `sha256:${'0'.repeat(64)}`,
        sha256After: `sha256:${'1'.repeat(64)}`,
      }],
      added: [],
    })).toThrow(CertificationError);
  });

  it('rejects two clean runs whose complete output digests differ', () => {
    expect(() => assertDeterministicRuns('candidate',
      { outputTreeDigest: `sha256:${'0'.repeat(64)}` },
      { outputTreeDigest: `sha256:${'1'.repeat(64)}` },
    )).toThrow(/different results/u);
  });
});

describe('failure evidence', () => {
  it('keeps test fixtures machine-readable', async () => {
    const directory = await temporary();
    const path = join(directory, 'manifest.json');
    await writeFile(path, '{"framework": null}\n');
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    expect(() => validateManifestShape(parsed, 'fixture')).toThrow(/fixture\.framework/u);
  });

  it('initializes an uploadable non-certification report and removes stale provenance', async () => {
    const directory = await temporary();
    await writeFile(join(directory, 'candidate-provenance.json'), '{"stale":true}\n');

    const report = await initializeFailureReport({
      outputDir: directory,
      ecosystems: new Set(['go']),
      sourceRevision: 'revision',
    });

    expect(report).toMatchObject({
      state: 'failed',
      targetCertificationState: 'not-assessed',
      behaviorallyCertified: false,
      stablePublishEligible: false,
      ecosystems: ['go'],
      failure: { phase: 'workflow-bootstrap' },
    });
    await expect(readFile(join(directory, 'candidate-provenance.json'), 'utf8')).rejects.toThrow();
    expect(JSON.parse(await readFile(join(directory, 'candidate-report.json'), 'utf8'))).toEqual(report);
  });

  it('redacts repository, temporary and unrelated absolute paths from a failure', async () => {
    const directory = await temporary();
    const unrelated = process.platform === 'win32' ? 'C:\\Users\\runner\\cache' : '/home/runner/cache';
    const sanitized = sanitizeFailureMessage(
      new Error(`failed under ${directory}/source, ${unrelated}/module and file://${unrelated}/archive`),
      root,
      join(directory, 'output'),
    );
    expect(sanitized).toContain('failed under');
    expect(sanitized).not.toContain(directory);
    expect(sanitized).not.toContain(unrelated);
    expect(sanitized).toContain('file://<absolute-path>');

    await expect(certify({ root: directory, outputDir: join(directory, 'output') })).rejects.toThrow();
    const report = JSON.parse(await readFile(join(directory, 'output/candidate-report.json'), 'utf8'));
    expect(report.state).toBe('failed');
    expect(report.failure.message).not.toContain(directory);
  });
});

describe('candidate provenance', () => {
  it('records the compatibility suite, toolchains and patch-set materials', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const report = {
      ecosystems: ['go'],
      gates: [
        { id: 'compatibility-registry-runtime-drift', status: 'pass' },
        { id: 'existing-tests:@termwright/probe-go', status: 'pass' },
      ],
      toolchains: { node: { version: 'v22.0.0' }, go: { version: 'go version go1.24 linux/amd64' } },
      candidates: [{
        id: 'example@v1.0.0#1',
        module: 'example',
        upstreamVersion: 'v1.0.0',
        patchSetPath: 'patches/example',
        patchSetDigest: digest,
        material: { source: 'go-module', upstreamTreeDigest: digest, zipDigest: digest },
        output: { outputTreeDigest: digest },
      }],
    };

    const statement = provenance(report, 'revision', digest, digest);
    expect(statement.predicate.buildDefinition.internalParameters.verificationSuites).toEqual([
      'compatibility-registry-runtime-drift',
      'existing-tests:@termwright/probe-go',
    ]);
    expect(statement.predicate.buildDefinition.internalParameters.toolchains).toEqual(report.toolchains);
    expect(statement.predicate.buildDefinition.resolvedDependencies).toContainEqual({
      uri: 'file:patches/example',
      digest: { sha256: 'a'.repeat(64) },
    });
  });
});
