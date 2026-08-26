import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractZipEntries,
  prepareConptyAssets,
  renderConptyMetadata,
  sha256,
} from './prepare-conpty-assets.mjs';
import { assertSafeStageDestination } from './stage-vendored-conpty.mjs';

function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name);
    const bytes = Buffer.from(value);
    const local = Buffer.alloc(30 + filename.length + bytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30);
    bytes.copy(local, 30 + filename.length);
    locals.push(local);

    const central = Buffer.alloc(46 + filename.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    filename.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

describe('the pinned ConPTY asset extractor', () => {
  it('extracts only exact allowlisted ZIP entries', () => {
    const archive = storedZip([
      ['runtimes/win-x64/native/conpty.dll', 'DLL'],
      ['build/native/runtimes/x64/OpenConsole.exe', 'HOST'],
      ['ignored.txt', 'NO'],
    ]);
    const result = extractZipEntries(archive, new Set([
      'runtimes/win-x64/native/conpty.dll',
      'build/native/runtimes/x64/OpenConsole.exe',
    ]));
    expect([...result]).toEqual([
      ['runtimes/win-x64/native/conpty.dll', Buffer.from('DLL')],
      ['build/native/runtimes/x64/OpenConsole.exe', Buffer.from('HOST')],
    ]);
    expect(sha256(result.get('runtimes/win-x64/native/conpty.dll'))).toBe(
      'c4fe7c2ebe956b8f828f33002806fb46594e9b304d3d4621be27c33325096a10',
    );
  });

  it('fails closed when a required upstream path is absent', () => {
    const archive = storedZip([['present', 'data']]);
    expect(() => extractZipEntries(archive, new Set(['missing']))).toThrow(/missing missing/u);
  });

  it('rejects an archive without a valid central directory', () => {
    expect(() => extractZipEntries(Buffer.from('not a zip'), new Set())).toThrow(/no ZIP end/u);
  });

  it('regenerates a complete sealed bundle from an offline pinned archive', async () => {
    const dll = Buffer.from('MZ synthetic conpty DLL');
    const host = Buffer.from('MZ synthetic OpenConsole host');
    const archive = storedZip([
      ['runtime/conpty.dll', dll],
      ['runtime/OpenConsole.exe', host],
    ]);
    const assets = {
      'conpty.dll': { entry: 'runtime/conpty.dll', sha256: sha256(dll) },
      'x64/OpenConsole.exe': { entry: 'runtime/OpenConsole.exe', sha256: sha256(host) },
    };
    const lock = {
      package: 'Microsoft.Windows.Console.ConPTY',
      version: 'test-version',
      url: 'https://api.nuget.org/test.nupkg',
      sha256: sha256(archive),
      projectUrl: 'https://github.com/microsoft/terminal',
      sbomCreated: '2026-08-26T00:00:00Z',
      assets: { x64: assets },
    };
    const assetDigests = Object.fromEntries(
      Object.entries(assets).map(([path, asset]) => [path, asset.sha256]),
    );
    const metadata = renderConptyMetadata(lock, 'x64', assetDigests);
    lock.metadata = {
      x64: Object.fromEntries([...metadata].map(([path, bytes]) => [path, sha256(bytes)])),
    };
    const root = await mkdtemp(join(tmpdir(), 'tw-conpty-prepare-'));
    const archivePath = join(root, 'conpty.nupkg');
    const destination = join(root, 'vendor');
    try {
      await writeFile(archivePath, archive);
      const manifest = await prepareConptyAssets({
        architecture: 'x64', destination, archivePath, lock,
      });
      expect((await readdir(destination, { recursive: true }))
        .map((path) => path.replaceAll('\\', '/')).sort()).toEqual([
        'LICENSE.microsoft-terminal.txt',
        'SBOM.spdx.json',
        'THIRD_PARTY_NOTICES.md',
        'conpty-manifest.json',
        'conpty.dll',
        'x64',
        'x64/OpenConsole.exe',
      ]);
      for (const [path, bytes] of metadata) {
        expect(await readFile(join(destination, path))).toEqual(bytes);
      }
      expect(manifest).toMatchObject({ assets: assetDigests, metadata: lock.metadata.x64 });
      const sbom = JSON.parse(await readFile(join(destination, 'SBOM.spdx.json'), 'utf8'));
      expect(sbom.packages[0]).toMatchObject({ filesAnalyzed: true });
      expect(sbom.packages[0].externalRefs[0].referenceLocator)
        .toBe('pkg:nuget/Microsoft.Windows.Console.ConPTY@test-version');
      expect(sbom.files.map((file) => [file.fileName, file.checksums[0].checksumValue]))
        .toEqual(Object.entries(assetDigests).map(([path, digest]) => [`./${path}`, digest]));

      const rejectedDestination = join(root, 'rejected-vendor');
      await mkdir(rejectedDestination);
      await writeFile(join(rejectedDestination, 'sentinel'), 'unchanged');
      const badLock = structuredClone(lock);
      badLock.metadata.x64['SBOM.spdx.json'] = '0'.repeat(64);
      await expect(prepareConptyAssets({
        architecture: 'x64', destination: rejectedDestination, archivePath, lock: badLock,
      })).rejects.toThrow(/generated ConPTY metadata SHA-256 mismatch/u);
      expect(await readdir(rejectedDestination)).toEqual(['sentinel']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('the ConPTY staging boundary', () => {
  it('allows only the native build vendor directory', () => {
    expect(assertSafeStageDestination('packages/pty/build/Release/vendor'))
      .toMatch(/packages[/\\]pty[/\\]build[/\\]Release[/\\]vendor$/u);
    expect(() => assertSafeStageDestination('.')).toThrow(/non-build ConPTY destination/u);
    expect(() => assertSafeStageDestination('packages/pty-win32-x64/vendor'))
      .toThrow(/non-build ConPTY destination/u);
  });
});
