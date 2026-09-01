import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareConptyAssets, renderConptyMetadata, sha256 } from './prepare-conpty-assets.mjs';
import { assertSafeStageDestination } from './stage-vendored-conpty.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tw-conpty-source-build-'));
  const artifact = join(root, 'artifact');
  const reviewed = join(root, 'reviewed');
  await mkdir(join(artifact, 'x64'), { recursive: true });
  await mkdir(join(artifact, 'arm64'), { recursive: true });
  await mkdir(reviewed);

  const binaries = {
    'x64/conpty.dll': Buffer.from('MZ synthetic x64 ConPTY DLL'),
    'x64/OpenConsole.exe': Buffer.from('MZ synthetic x64 OpenConsole'),
    'arm64/conpty.dll': Buffer.from('MZ synthetic arm64 ConPTY DLL'),
    'arm64/OpenConsole.exe': Buffer.from('MZ synthetic arm64 OpenConsole'),
  };
  const patch = Buffer.from('exact T3 patch');
  const license = Buffer.from('Microsoft MIT license\r\n');
  const notice = Buffer.from('Microsoft upstream notice\r\n');
  const commit = 'd'.repeat(40);
  const archiveSha256 = 'a'.repeat(64);
  const patchSha256 = sha256(patch);
  const sourceManifest = {
    schemaVersion: 1,
    tier: 'T3',
    capability: 'request-addressed-host-cursor-and-atomic-application-reply-rpc',
    upstream: {
      repository: 'https://github.com/microsoft/terminal',
      commit,
      archiveUrl: `https://github.com/microsoft/terminal/archive/${commit}.tar.gz`,
      archiveSha256,
    },
    patch: { sha256: patchSha256 },
    protocol: {
      osc: 8488,
      request: 'ESC ] 8488 ; twh-cpr-v1:q:<token> BEL',
      response: 'ESC ] 8488 ; twh-cpr-v1:r:<token>:<row>:<column> BEL',
      applicationResponse: 'ESC ] 8488 ; twh-app-reply-v1:<length>:<hex> BEL',
      applicationResponseMaximumBytes: 4096,
    },
    build: { configuration: 'Release', platformToolset: 'v143' },
  };
  const sourceManifestBytes = Buffer.from(`${JSON.stringify(sourceManifest, null, 2)}\n`);
  const sourceManifestSha256 = sha256(sourceManifestBytes);
  const binaryDigests = Object.fromEntries(
    Object.entries(binaries).map(([path, bytes]) => [path, sha256(bytes)]),
  );
  const provenance = {
    schemaVersion: 1,
    upstreamRepository: sourceManifest.upstream.repository,
    upstreamCommit: commit,
    upstreamArchiveSha256: archiveSha256,
    patchSha256,
    buildConfiguration: 'Release',
    platformToolset: 'v143',
    binaryDigests,
    status: 'uncertified-bootstrap-output',
  };
  for (const [path, bytes] of Object.entries(binaries)) {
    await writeFile(join(artifact, path), bytes);
  }
  await writeFile(join(artifact, 'source-manifest.json'), sourceManifestBytes);
  await writeFile(join(reviewed, 'manifest.json'), sourceManifestBytes);
  await writeFile(join(artifact, 'host-cursor-rpc.patch'), patch);
  await writeFile(join(artifact, 'LICENSE.microsoft-terminal.txt'), license);
  await writeFile(join(artifact, 'NOTICE.microsoft-terminal.md'), notice);
  await writeFile(
    join(artifact, 'bootstrap-provenance.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );

  const lock = {
    schemaVersion: 2,
    identity: {
      provider: 'termwright-patched-openconsole',
      upstreamCommit: commit,
      upstreamArchiveSha256: archiveSha256,
      patchSha256,
      hostCursorRpc: 'twh-cpr-v1',
      applicationReplyRpc: 'twh-app-reply-v1',
      mode: 'ordered-vt-passthrough',
      buildConfiguration: 'Release',
      platformToolset: 'v143',
    },
    sourceManifest: {
      repositoryPath: 'reviewed/manifest.json',
      artifactPath: 'source-manifest.json',
      sha256: sourceManifestSha256,
    },
    artifact: { requiredStatus: 'uncertified-bootstrap-output' },
    sbomCreated: '2026-08-31T00:00:00Z',
    legal: {
      license: { artifactPath: 'LICENSE.microsoft-terminal.txt', sha256: sha256(license) },
      notice: { artifactPath: 'NOTICE.microsoft-terminal.md', sha256: sha256(notice) },
    },
    assets: {
      x64: {
        'conpty.dll': { artifactPath: 'x64/conpty.dll', sha256: binaryDigests['x64/conpty.dll'] },
        'x64/OpenConsole.exe': {
          artifactPath: 'x64/OpenConsole.exe',
          sha256: binaryDigests['x64/OpenConsole.exe'],
        },
        'arm64/OpenConsole.exe': {
          artifactPath: 'arm64/OpenConsole.exe',
          sha256: binaryDigests['arm64/OpenConsole.exe'],
        },
      },
    },
    metadata: { x64: {} },
  };
  const assetDigests = Object.fromEntries(
    Object.entries(lock.assets.x64).map(([path, asset]) => [path, asset.sha256]),
  );
  const metadata = renderConptyMetadata({
    lock,
    sourceManifest,
    architecture: 'x64',
    assetDigests,
    assetSha1Digests: Object.fromEntries(
      Object.entries(lock.assets.x64).map(([path, asset]) => [
        path,
        createHash('sha1').update(binaries[asset.artifactPath]).digest('hex'),
      ]),
    ),
    licenseBytes: license,
    upstreamNoticeBytes: notice,
  });
  lock.metadata.x64 = Object.fromEntries(
    [...metadata].map(([path, bytes]) => [path, sha256(bytes)]),
  );
  return { root, artifact, lock, metadata };
}

describe('the source-built ConPTY asset sealer', () => {
  it('seals only an exact offline bootstrap artifact with truthful provenance', async () => {
    const { root, artifact, lock, metadata } = await fixture();
    const destination = join(root, 'vendor');
    try {
      const manifest = await prepareConptyAssets({
        architecture: 'x64',
        destination,
        artifactDirectory: artifact,
        lock,
        repositoryRoot: root,
      });
      expect(
        (await readdir(destination, { recursive: true }))
          .map((path) => path.replaceAll('\\', '/'))
          .sort(),
      ).toEqual([
        'LICENSE.microsoft-terminal.txt',
        'NOTICE.microsoft-terminal.md',
        'SBOM.spdx.json',
        'THIRD_PARTY_NOTICES.md',
        'arm64',
        'arm64/OpenConsole.exe',
        'conpty-manifest.json',
        'conpty.dll',
        'x64',
        'x64/OpenConsole.exe',
      ]);
      for (const [path, bytes] of metadata) {
        expect(await readFile(join(destination, path))).toEqual(bytes);
      }
      expect(
        await readFile(join(destination, 'LICENSE.microsoft-terminal.txt'), 'utf8'),
      ).not.toContain('\r');
      expect(manifest).toMatchObject({
        schemaVersion: 2,
        provider: 'termwright-patched-openconsole',
        upstreamCommit: lock.identity.upstreamCommit,
        patchSha256: lock.identity.patchSha256,
        hostCursorRpc: 'twh-cpr-v1',
        applicationReplyRpc: 'twh-app-reply-v1',
        assets: Object.fromEntries(
          Object.entries(lock.assets.x64).map(([path, asset]) => [path, asset.sha256]),
        ),
      });
      const sbom = JSON.parse(await readFile(join(destination, 'SBOM.spdx.json'), 'utf8'));
      expect(sbom.packages.find(({ SPDXID }) => SPDXID === 'SPDXRef-Package-ConPTY')).toMatchObject(
        {
          name: 'termwright-patched-openconsole',
          downloadLocation: 'NOASSERTION',
          filesAnalyzed: true,
          licenseConcluded: 'NOASSERTION',
          licenseDeclared: 'NOASSERTION',
          copyrightText: 'NOASSERTION',
        },
      );
      expect(
        sbom.packages.find(({ SPDXID }) => SPDXID === 'SPDXRef-Package-Upstream'),
      ).toMatchObject({
        name: 'microsoft/terminal',
        versionInfo: lock.identity.upstreamCommit,
      });
      expect(JSON.stringify(sbom)).not.toMatch(/nuget/u);
      expect(sbom.files.map(({ fileName }) => fileName)).toContain(
        './NOTICE.microsoft-terminal.md',
      );
      expect(
        sbom.files.every(
          ({ licenseConcluded, copyrightText }) =>
            licenseConcluded === 'NOASSERTION' && copyrightText === 'NOASSERTION',
        ),
      ).toBe(true);
      const describedVersion = sbom.packages.find(
        ({ SPDXID }) => SPDXID === 'SPDXRef-Package-ConPTY',
      ).versionInfo;
      expect(describedVersion).toContain(lock.identity.patchSha256);
      expect(describedVersion).toContain(lock.sourceManifest.sha256);
      expect(sbom.documentNamespace).toContain(lock.identity.patchSha256);
      expect(sbom.documentNamespace).toContain(lock.sourceManifest.sha256);
      expect(sbom.relationships).toContainEqual({
        spdxElementId: 'SPDXRef-Package-ConPTY',
        relationshipType: 'GENERATED_FROM',
        relatedSpdxElement: 'SPDXRef-Package-Upstream',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never downloads and does not replace a valid destination after failed verification', async () => {
    const { root, artifact, lock } = await fixture();
    const destination = join(root, 'vendor');
    try {
      await mkdir(destination);
      await writeFile(join(destination, 'sentinel'), 'unchanged');
      await expect(
        prepareConptyAssets({
          architecture: 'x64',
          destination,
          artifactDirectory: undefined,
          lock,
          repositoryRoot: root,
        }),
      ).rejects.toThrow(/local --artifact-dir is required/u);
      const badLock = structuredClone(lock);
      badLock.metadata.x64['SBOM.spdx.json'] = '0'.repeat(64);
      await expect(
        prepareConptyAssets({
          architecture: 'x64',
          destination,
          artifactDirectory: artifact,
          lock: badLock,
          repositoryRoot: root,
        }),
      ).rejects.toThrow(/generated ConPTY metadata SHA-256 mismatch/u);
      expect(await readdir(destination)).toEqual(['sentinel']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects legacy NuGet lock keys and extra artifact files', async () => {
    const { root, artifact, lock } = await fixture();
    try {
      await expect(
        prepareConptyAssets({
          architecture: 'x64',
          destination: join(root, 'legacy'),
          artifactDirectory: artifact,
          lock: { ...lock, url: 'https://api.nuget.org/legacy.nupkg' },
          repositoryRoot: root,
        }),
      ).rejects.toThrow(/legacy ConPTY lock key is forbidden: url/u);
      const extraMetadataLock = structuredClone(lock);
      extraMetadataLock.metadata.x64['legacy.json'] = '0'.repeat(64);
      await expect(
        prepareConptyAssets({
          architecture: 'x64',
          destination: join(root, 'legacy-metadata'),
          artifactDirectory: artifact,
          lock: extraMetadataLock,
          repositoryRoot: root,
        }),
      ).rejects.toThrow(/metadata inventory differs/u);
      await writeFile(join(artifact, 'unexpected'), 'unexpected');
      await expect(
        prepareConptyAssets({
          architecture: 'x64',
          destination: join(root, 'extra'),
          artifactDirectory: artifact,
          lock,
          repositoryRoot: root,
        }),
      ).rejects.toThrow(/artifact inventory differs/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'a source manifest that differs from the reviewed repository copy',
      async ({ artifact }) => writeFile(join(artifact, 'source-manifest.json'), '{}\n'),
      /differs from the reviewed repository manifest/u,
    ],
    [
      'a modified T3 patch',
      async ({ artifact }) => writeFile(join(artifact, 'host-cursor-rpc.patch'), 'modified'),
      /T3 patch SHA-256 mismatch/u,
    ],
    [
      'provenance that does not attest the binary',
      async ({ artifact }) => {
        const path = join(artifact, 'bootstrap-provenance.json');
        const provenance = JSON.parse(await readFile(path, 'utf8'));
        provenance.binaryDigests['x64/conpty.dll'] = '0'.repeat(64);
        await writeFile(path, `${JSON.stringify(provenance, null, 2)}\n`);
      },
      /binary SHA-256 mismatch/u,
    ],
    [
      'a repository manifest path outside the repository root',
      async ({ lock }) => {
        lock.sourceManifest.repositoryPath = '../outside.json';
      },
      /escapes its root/u,
    ],
    [
      'a binary copied from the other architecture',
      async ({ artifact }) => {
        await writeFile(
          join(artifact, 'x64/conpty.dll'),
          await readFile(join(artifact, 'arm64/conpty.dll')),
        );
      },
      /binary SHA-256 mismatch/u,
    ],
  ])('rejects %s', async (_description, mutate, diagnostic) => {
    const context = await fixture();
    try {
      await mutate(context);
      await expect(
        prepareConptyAssets({
          architecture: 'x64',
          destination: join(context.root, 'vendor'),
          artifactDirectory: context.artifact,
          lock: context.lock,
          repositoryRoot: context.root,
        }),
      ).rejects.toThrow(diagnostic);
    } finally {
      await rm(context.root, { recursive: true, force: true });
    }
  });
});

describe('the ConPTY staging boundary', () => {
  it('allows only the native build vendor directory', () => {
    expect(assertSafeStageDestination('packages/pty/build/Release/vendor')).toMatch(
      /packages[/\\]pty[/\\]build[/\\]Release[/\\]vendor$/u,
    );
    expect(() => assertSafeStageDestination('.')).toThrow(/non-build ConPTY destination/u);
    expect(() => assertSafeStageDestination('packages/pty-win32-x64/vendor')).toThrow(
      /non-build ConPTY destination/u,
    );
  });
});
