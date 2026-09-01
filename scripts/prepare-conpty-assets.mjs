#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, lstat, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectExecution } from './is-direct-execution.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCK_PATH = resolve(ROOT, 'packages/pty/conpty-assets.json');
const ARTIFACT_FILES = Object.freeze([
  'LICENSE.microsoft-terminal.txt',
  'NOTICE.microsoft-terminal.md',
  'arm64/OpenConsole.exe',
  'arm64/conpty.dll',
  'bootstrap-provenance.json',
  'host-cursor-rpc.patch',
  'source-manifest.json',
  'x64/OpenConsole.exe',
  'x64/conpty.dll',
]);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha1(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

async function filesBelow(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await filesBelow(join(directory, entry.name), name)));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`ConPTY bootstrap artifact contains a non-file entry: ${name}`);
  }
  return files;
}

function confined(root, relativePath, description) {
  const output = resolve(root, relativePath);
  const fromRoot = relative(root, output);
  if (
    isAbsolute(fromRoot) ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new Error(`${description} escapes its root: ${relativePath}`);
  }
  return output;
}

async function exactFile(root, relativePath, description) {
  const path = confined(root, relativePath, description);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${description} is not a regular file: ${relativePath}`);
  }
  return readFile(path);
}

function sourceVersion(lock) {
  return (
    `${lock.identity.upstreamCommit}+${lock.identity.hostCursorRpc}.` +
    `${lock.identity.applicationReplyRpc}.` +
    `${lock.identity.patchSha256}.${lock.sourceManifest.sha256}`
  );
}

function normalizedUtf8(bytes) {
  return Buffer.from(Buffer.from(bytes).toString('utf8').replaceAll('\r\n', '\n'));
}

function assertSchema(lock) {
  if (
    lock.schemaVersion !== 2 ||
    lock.identity?.provider !== 'termwright-patched-openconsole' ||
    lock.identity?.mode !== 'ordered-vt-passthrough' ||
    lock.identity?.hostCursorRpc !== 'twh-cpr-v1' ||
    lock.identity?.applicationReplyRpc !== 'twh-app-reply-v1' ||
    typeof lock.identity?.upstreamCommit !== 'string' ||
    typeof lock.identity?.upstreamArchiveSha256 !== 'string' ||
    typeof lock.identity?.patchSha256 !== 'string' ||
    typeof lock.identity?.buildConfiguration !== 'string' ||
    typeof lock.identity?.platformToolset !== 'string' ||
    typeof lock.sourceManifest?.repositoryPath !== 'string' ||
    typeof lock.sourceManifest?.artifactPath !== 'string' ||
    typeof lock.sourceManifest?.sha256 !== 'string' ||
    lock.artifact?.requiredStatus !== 'uncertified-bootstrap-output'
  ) {
    throw new Error('invalid source-built ConPTY asset lock schema');
  }
  for (const forbidden of ['package', 'version', 'url', 'sha256']) {
    if (Object.hasOwn(lock, forbidden))
      throw new Error(`legacy ConPTY lock key is forbidden: ${forbidden}`);
  }
}

function assertSourceContract(lock, sourceManifest, provenance) {
  const identity = lock.identity;
  if (
    sourceManifest.schemaVersion !== 1 ||
    sourceManifest.tier !== 'T3' ||
    sourceManifest.capability !==
      'request-addressed-host-cursor-and-atomic-application-reply-rpc' ||
    sourceManifest.upstream?.repository !== 'https://github.com/microsoft/terminal' ||
    sourceManifest.upstream?.commit !== identity.upstreamCommit ||
    sourceManifest.upstream?.archiveSha256 !== identity.upstreamArchiveSha256 ||
    sourceManifest.patch?.sha256 !== identity.patchSha256 ||
    sourceManifest.protocol?.osc !== 8488 ||
    !sourceManifest.protocol?.request?.includes('twh-cpr-v1:q:') ||
    !sourceManifest.protocol?.response?.includes('twh-cpr-v1:r:') ||
    !sourceManifest.protocol?.applicationResponse?.includes('twh-app-reply-v1:') ||
    sourceManifest.protocol?.applicationResponseMaximumBytes !== 4096 ||
    sourceManifest.build?.configuration !== identity.buildConfiguration ||
    sourceManifest.build?.platformToolset !== identity.platformToolset
  ) {
    throw new Error('ConPTY source manifest does not match the locked host RPC contract');
  }
  if (
    provenance.schemaVersion !== 1 ||
    provenance.status !== lock.artifact.requiredStatus ||
    provenance.upstreamRepository !== sourceManifest.upstream.repository ||
    provenance.upstreamCommit !== sourceManifest.upstream.commit ||
    provenance.upstreamArchiveSha256 !== sourceManifest.upstream.archiveSha256 ||
    provenance.patchSha256 !== sourceManifest.patch.sha256 ||
    provenance.buildConfiguration !== sourceManifest.build.configuration ||
    provenance.platformToolset !== sourceManifest.build.platformToolset
  ) {
    throw new Error('ConPTY bootstrap provenance does not match the exact source build');
  }
}

export function renderConptyMetadata({
  lock,
  sourceManifest,
  architecture,
  assetDigests,
  assetSha1Digests,
  licenseBytes,
  upstreamNoticeBytes,
}) {
  const identity = lock.identity;
  const upstream = sourceManifest.upstream;
  const version = sourceVersion(lock);
  const packagedLicenseBytes = normalizedUtf8(licenseBytes);
  const packagedNoticeBytes = normalizedUtf8(upstreamNoticeBytes);
  const notice = `# Termwright-patched Microsoft Windows Console ConPTY

Termwright redistributes \`conpty.dll\` and \`OpenConsole.exe\` built from
Microsoft Terminal source commit \`${upstream.commit}\` and modified by the
exact Termwright T3 host-cursor/application-reply patch \`${identity.patchSha256}\`.

These are Termwright-built modified binaries, not official Microsoft binaries.
The source archive, patch, build provenance and every redistributed binary are
verified by SHA-256 before staging.

Upstream project: <${upstream.repository}>
Upstream source: <${upstream.archiveUrl}>
Top-level upstream project license: MIT. See the bundled upstream NOTICE for
third-party license terms carried by the source and resulting binaries.
`;
  const thirdPartyNoticeBytes = Buffer.from(notice);
  const inventoriedFiles = [
    ...Object.entries(assetDigests).map(([relativePath, digest]) => ({
      relativePath,
      sha1: assetSha1Digests[relativePath],
      sha256: digest,
    })),
    {
      relativePath: 'LICENSE.microsoft-terminal.txt',
      sha1: sha1(packagedLicenseBytes),
      sha256: sha256(packagedLicenseBytes),
    },
    {
      relativePath: 'NOTICE.microsoft-terminal.md',
      sha1: sha1(packagedNoticeBytes),
      sha256: sha256(packagedNoticeBytes),
    },
    {
      relativePath: 'THIRD_PARTY_NOTICES.md',
      sha1: sha1(thirdPartyNoticeBytes),
      sha256: sha256(thirdPartyNoticeBytes),
    },
  ];
  const files = inventoriedFiles.map(
    ({ relativePath, sha1: sha1Digest, sha256: digest }, index) => ({
      SPDXID: `SPDXRef-File-${index + 1}`,
      fileName: `./${relativePath}`,
      checksums: [
        { algorithm: 'SHA1', checksumValue: sha1Digest },
        { algorithm: 'SHA256', checksumValue: digest },
      ],
      licenseConcluded: 'NOASSERTION',
      copyrightText: 'NOASSERTION',
    }),
  );
  const packageVerificationCode = createHash('sha1')
    .update(
      inventoriedFiles
        .map((file) => file.sha1)
        .sort()
        .join(''),
    )
    .digest('hex');
  const builtPackage = {
    SPDXID: 'SPDXRef-Package-ConPTY',
    name: identity.provider,
    versionInfo: version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: true,
    packageVerificationCode: {
      packageVerificationCodeValue: packageVerificationCode,
      packageVerificationCodeExcludedFiles: ['conpty-manifest.json', 'SBOM.spdx.json'],
    },
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    sourceInfo:
      `Built from microsoft/terminal ${upstream.commit}; ` +
      `archive sha256:${upstream.archiveSha256}; ` +
      `Termwright T3 patch sha256:${identity.patchSha256}; ` +
      `source manifest sha256:${lock.sourceManifest.sha256}`,
  };
  const upstreamPackage = {
    SPDXID: 'SPDXRef-Package-Upstream',
    name: 'microsoft/terminal',
    versionInfo: upstream.commit,
    downloadLocation: upstream.archiveUrl,
    checksums: [{ algorithm: 'SHA256', checksumValue: upstream.archiveSha256 }],
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'MIT',
    copyrightText: 'NOASSERTION',
    externalRefs: [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:github/microsoft/terminal@${upstream.commit}`,
      },
    ],
  };
  const sbom = {
    SPDXID: 'SPDXRef-DOCUMENT',
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    name: `termwright-vendored-conpty-${architecture}-${version}`,
    documentNamespace: `https://github.com/Gorce-AI/termwright/sbom/conpty/${architecture}/${version}`,
    creationInfo: {
      created: lock.sbomCreated,
      creators: ['Tool: Termwright source-built ConPTY sealer'],
    },
    packages: [builtPackage, upstreamPackage],
    relationships: [
      {
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: builtPackage.SPDXID,
      },
      {
        spdxElementId: builtPackage.SPDXID,
        relationshipType: 'GENERATED_FROM',
        relatedSpdxElement: upstreamPackage.SPDXID,
      },
      ...files.map((file) => ({
        spdxElementId: builtPackage.SPDXID,
        relationshipType: 'CONTAINS',
        relatedSpdxElement: file.SPDXID,
      })),
    ],
    files,
  };
  return new Map([
    ['LICENSE.microsoft-terminal.txt', packagedLicenseBytes],
    ['NOTICE.microsoft-terminal.md', packagedNoticeBytes],
    ['THIRD_PARTY_NOTICES.md', thirdPartyNoticeBytes],
    ['SBOM.spdx.json', Buffer.from(`${JSON.stringify(sbom, null, 2)}\n`)],
  ]);
}

export async function prepareConptyAssets({
  architecture,
  destination,
  artifactDirectory,
  lock: suppliedLock,
  repositoryRoot = ROOT,
}) {
  if (artifactDirectory === undefined) {
    throw new TypeError(
      'a local --artifact-dir is required; the ConPTY sealer never downloads inputs',
    );
  }
  const lock = suppliedLock ?? JSON.parse(await readFile(LOCK_PATH, 'utf8'));
  assertSchema(lock);
  const assets = lock.assets?.[architecture];
  const expectedMetadata = lock.metadata?.[architecture];
  if (assets === undefined || expectedMetadata === undefined) {
    throw new TypeError(`unsupported ConPTY architecture: ${architecture}`);
  }

  const artifactRoot = resolve(artifactDirectory);
  const actualArtifactFiles = (await filesBelow(artifactRoot)).sort();
  if (JSON.stringify(actualArtifactFiles) !== JSON.stringify([...ARTIFACT_FILES].sort())) {
    throw new Error(
      `ConPTY bootstrap artifact inventory differs: ${actualArtifactFiles.join(', ')}`,
    );
  }

  const repositoryManifest = await readFile(
    confined(repositoryRoot, lock.sourceManifest.repositoryPath, 'ConPTY source manifest'),
  );
  if (sha256(repositoryManifest) !== lock.sourceManifest.sha256) {
    throw new Error('repository ConPTY source manifest SHA-256 mismatch');
  }
  const artifactManifest = await exactFile(
    artifactRoot,
    lock.sourceManifest.artifactPath,
    'ConPTY artifact source manifest',
  );
  if (!artifactManifest.equals(repositoryManifest)) {
    throw new Error(
      'artifact ConPTY source manifest differs from the reviewed repository manifest',
    );
  }
  const sourceManifest = JSON.parse(repositoryManifest.toString('utf8'));
  const provenance = JSON.parse(
    (
      await exactFile(artifactRoot, 'bootstrap-provenance.json', 'ConPTY bootstrap provenance')
    ).toString('utf8'),
  );
  assertSourceContract(lock, sourceManifest, provenance);

  const patchBytes = await exactFile(artifactRoot, 'host-cursor-rpc.patch', 'ConPTY T3 patch');
  if (sha256(patchBytes) !== lock.identity.patchSha256) {
    throw new Error('artifact ConPTY T3 patch SHA-256 mismatch');
  }
  const licenseBytes = await exactFile(
    artifactRoot,
    lock.legal.license.artifactPath,
    'Microsoft Terminal license',
  );
  const upstreamNoticeBytes = await exactFile(
    artifactRoot,
    lock.legal.notice.artifactPath,
    'Microsoft Terminal notice',
  );
  if (
    sha256(licenseBytes) !== lock.legal.license.sha256 ||
    sha256(upstreamNoticeBytes) !== lock.legal.notice.sha256
  ) {
    throw new Error('Microsoft Terminal legal metadata SHA-256 mismatch');
  }

  const preparedAssets = new Map();
  const assetDigests = {};
  const assetSha1Digests = {};
  for (const [relativePath, asset] of Object.entries(assets)) {
    const bytes = await exactFile(artifactRoot, asset.artifactPath, 'ConPTY binary');
    const digest = sha256(bytes);
    if (digest !== asset.sha256 || provenance.binaryDigests?.[asset.artifactPath] !== digest) {
      throw new Error(`ConPTY binary SHA-256 mismatch: ${asset.artifactPath}`);
    }
    preparedAssets.set(relativePath, bytes);
    assetDigests[relativePath] = digest;
    assetSha1Digests[relativePath] = sha1(bytes);
  }
  const metadata = renderConptyMetadata({
    lock,
    sourceManifest,
    architecture,
    assetDigests,
    assetSha1Digests,
    licenseBytes,
    upstreamNoticeBytes,
  });
  if (
    JSON.stringify([...metadata.keys()].sort()) !==
    JSON.stringify(Object.keys(expectedMetadata).sort())
  ) {
    throw new Error('locked ConPTY metadata inventory differs from the sealer output');
  }
  for (const [relativePath, bytes] of metadata) {
    const digest = sha256(bytes);
    if (expectedMetadata[relativePath] !== digest) {
      throw new Error(`generated ConPTY metadata SHA-256 mismatch: ${relativePath} ${digest}`);
    }
  }

  const manifest = {
    schemaVersion: 2,
    provider: lock.identity.provider,
    upstreamCommit: lock.identity.upstreamCommit,
    upstreamArchiveSha256: lock.identity.upstreamArchiveSha256,
    patchSha256: lock.identity.patchSha256,
    hostCursorRpc: lock.identity.hostCursorRpc,
    applicationReplyRpc: lock.identity.applicationReplyRpc,
    sourceManifestSha256: lock.sourceManifest.sha256,
    build: {
      configuration: sourceManifest.build.configuration,
      platformToolset: sourceManifest.build.platformToolset,
    },
    architecture,
    mode: lock.identity.mode,
    assets: assetDigests,
    metadata: expectedMetadata,
  };

  const destinationRoot = resolve(destination);
  await mkdir(dirname(destinationRoot), { recursive: true });
  const stagingRoot = await mkdtemp(join(dirname(destinationRoot), '.conpty-seal-'));
  try {
    for (const [relativePath, bytes] of preparedAssets) {
      const output = confined(stagingRoot, relativePath, 'ConPTY destination asset');
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, bytes, { mode: relativePath.endsWith('.exe') ? 0o755 : 0o644 });
    }
    for (const [relativePath, bytes] of metadata) {
      await writeFile(confined(stagingRoot, relativePath, 'ConPTY destination metadata'), bytes, {
        mode: 0o644,
      });
    }
    await writeFile(
      join(stagingRoot, 'conpty-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o644 },
    );
    await rm(destinationRoot, { recursive: true, force: true });
    await rename(stagingRoot, destinationRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (isDirectExecution(import.meta.url)) {
  const architecture = argument('--architecture');
  const destination = argument('--destination');
  const artifactDirectory = argument('--artifact-dir');
  if (architecture === undefined || destination === undefined || artifactDirectory === undefined) {
    throw new TypeError(
      'usage: prepare-conpty-assets --architecture <x64|arm64> --destination <directory> --artifact-dir <downloaded-bootstrap-directory>',
    );
  }
  const manifest = await prepareConptyAssets({ architecture, destination, artifactDirectory });
  console.log(
    `sealed ${manifest.upstreamCommit}+${manifest.hostCursorRpc}+${manifest.applicationReplyRpc} for ${architecture}`,
  );
}
