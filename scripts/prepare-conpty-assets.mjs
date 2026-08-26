#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCK_PATH = resolve(ROOT, 'packages/pty/conpty-assets.json');
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const MICROSOFT_MIT_LICENSE = `Copyright (c) Microsoft Corporation. All rights reserved.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function renderConptyMetadata(lock, architecture, assetDigests) {
  const notice = `# Microsoft Windows Console ConPTY

Termwright redistributes \`conpty.dll\` and \`OpenConsole.exe\` from the official
\`${lock.package}\` NuGet package, version \`${lock.version}\`.
The binaries are provided by Microsoft under the MIT License. The pinned NuGet
archive and every redistributed binary are verified by SHA-256 before staging.

Project: <${lock.projectUrl}>
`;
  const files = Object.entries(assetDigests).map(([relativePath, digest], index) => ({
    SPDXID: `SPDXRef-File-${index + 1}`,
    fileName: `./${relativePath}`,
    checksums: [{ algorithm: 'SHA256', checksumValue: digest }],
    licenseConcluded: 'MIT',
    copyrightText: 'Copyright (c) Microsoft Corporation. All rights reserved.',
  }));
  const sbom = {
    SPDXID: 'SPDXRef-DOCUMENT',
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    name: `termwright-vendored-conpty-${architecture}-${lock.version}`,
    documentNamespace: `https://github.com/Gorce-AI/termwright/sbom/conpty/${architecture}/${lock.version}`,
    creationInfo: {
      created: lock.sbomCreated,
      creators: ['Tool: Termwright vendored dependency manifest'],
    },
    packages: [{
      SPDXID: 'SPDXRef-Package-ConPTY',
      name: lock.package,
      versionInfo: lock.version,
      downloadLocation: lock.url,
      checksums: [{ algorithm: 'SHA256', checksumValue: lock.sha256 }],
      filesAnalyzed: true,
      licenseConcluded: 'MIT',
      licenseDeclared: 'MIT',
      copyrightText: 'Copyright (c) Microsoft Corporation. All rights reserved.',
      externalRefs: [{
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:nuget/${lock.package}@${lock.version}`,
      }],
    }],
    relationships: [
      {
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: 'SPDXRef-Package-ConPTY',
      },
      ...files.map((file) => ({
        spdxElementId: 'SPDXRef-Package-ConPTY',
        relationshipType: 'CONTAINS',
        relatedSpdxElement: file.SPDXID,
      })),
    ],
    files,
  };
  return new Map([
    ['LICENSE.microsoft-terminal.txt', Buffer.from(MICROSOFT_MIT_LICENSE)],
    ['THIRD_PARTY_NOTICES.md', Buffer.from(notice)],
    ['SBOM.spdx.json', Buffer.from(`${JSON.stringify(sbom, null, 2)}\n`)],
  ]);
}

export function extractZipEntries(archive, wanted) {
  let eocd = -1;
  const minimum = Math.max(0, archive.length - 0xffff - 22);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('ConPTY NuGet archive has no ZIP end record');
  const disk = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  if (disk !== 0 || centralDisk !== 0) throw new Error('multi-disk NuGet archives are unsupported');
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  const found = new Map();
  for (let index = 0; index < count; index += 1) {
    if (offset > archive.length - 46 || archive.readUInt32LE(offset) !== CENTRAL) {
      throw new Error('ConPTY NuGet archive has an invalid central directory');
    }
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!wanted.has(name)) continue;
    if (localOffset > archive.length - 30 || archive.readUInt32LE(localOffset) !== LOCAL) {
      throw new Error(`ConPTY NuGet entry ${name} has an invalid local header`);
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > archive.length) throw new Error(`ConPTY NuGet entry ${name} is truncated`);
    const compressed = archive.subarray(start, end);
    const bytes = method === 0 ? Buffer.from(compressed)
      : method === 8 ? inflateRawSync(compressed)
        : undefined;
    if (bytes === undefined) throw new Error(`ConPTY NuGet entry ${name} uses compression ${method}`);
    if (bytes.length !== size) throw new Error(`ConPTY NuGet entry ${name} has the wrong size`);
    found.set(name, bytes);
  }
  for (const name of wanted) {
    if (!found.has(name)) throw new Error(`ConPTY NuGet archive is missing ${name}`);
  }
  return found;
}

export async function prepareConptyAssets({ architecture, destination, archivePath, lock: suppliedLock }) {
  const lock = suppliedLock ?? JSON.parse(await readFile(LOCK_PATH, 'utf8'));
  const assets = lock.assets?.[architecture];
  if (assets === undefined) throw new TypeError(`unsupported ConPTY architecture: ${architecture}`);
  const archive = archivePath === undefined
    ? Buffer.from(await (async () => {
      const response = await fetch(lock.url, { redirect: 'error' });
      if (!response.ok) throw new Error(`ConPTY NuGet download failed with HTTP ${response.status}`);
      return response.arrayBuffer();
    })())
    : await readFile(archivePath);
  const archiveDigest = sha256(archive);
  if (archiveDigest !== lock.sha256) {
    throw new Error(`ConPTY NuGet SHA-256 mismatch: ${archiveDigest}`);
  }
  const entries = extractZipEntries(archive, new Set(Object.values(assets).map((asset) => asset.entry)));
  const destinationRoot = resolve(destination);
  const preparedAssets = new Map();
  for (const [relativePath, asset] of Object.entries(assets)) {
    const bytes = entries.get(asset.entry);
    const digest = sha256(bytes);
    if (digest !== asset.sha256) throw new Error(`${asset.entry} SHA-256 mismatch: ${digest}`);
    const output = resolve(destinationRoot, relativePath);
    const fromRoot = relative(destinationRoot, output);
    if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new Error(`ConPTY asset escapes its destination: ${relativePath}`);
    }
    preparedAssets.set(relativePath, bytes);
  }
  const assetDigests = Object.fromEntries(
    Object.entries(assets).map(([path, asset]) => [path, asset.sha256]),
  );
  const metadata = renderConptyMetadata(lock, architecture, assetDigests);
  const expectedMetadata = lock.metadata?.[architecture];
  if (expectedMetadata === undefined) throw new Error(`ConPTY metadata lock is absent for ${architecture}`);
  for (const [relativePath, bytes] of metadata) {
    const digest = sha256(bytes);
    if (expectedMetadata[relativePath] !== digest) {
      throw new Error(`generated ConPTY metadata SHA-256 mismatch: ${relativePath} ${digest}`);
    }
  }
  const manifest = {
    schemaVersion: 1,
    package: lock.package,
    version: lock.version,
    sourceSha256: lock.sha256,
    architecture,
    mode: 'ordered-vt-passthrough',
    assets: assetDigests,
    metadata: expectedMetadata,
  };
  // Do not touch the destination until the archive, every binary and every
  // generated metadata file has passed its lock. A lock update in progress
  // must not leave a previously valid checked-in bundle half-replaced.
  for (const [relativePath, bytes] of preparedAssets) {
    const output = resolve(destinationRoot, relativePath);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes, { mode: relativePath.endsWith('.exe') ? 0o755 : 0o644 });
  }
  for (const [relativePath, bytes] of metadata) {
    await writeFile(resolve(destinationRoot, relativePath), bytes, { mode: 0o644 });
  }
  await writeFile(resolve(destinationRoot, 'conpty-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const architecture = argument('--architecture');
  const destination = argument('--destination');
  const archivePath = argument('--archive');
  if (architecture === undefined || destination === undefined) {
    throw new TypeError('usage: prepare-conpty-assets --architecture <x64|arm64> --destination <directory> [--archive <nupkg>]');
  }
  const manifest = await prepareConptyAssets({ architecture, destination, archivePath });
  console.log(`prepared ${manifest.package} ${manifest.version} for ${architecture}`);
}
