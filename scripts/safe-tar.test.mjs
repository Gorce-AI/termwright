import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeExtractTarGz } from './safe-tar.mjs';

function header(name, contents = Buffer.alloc(0), type = '0') {
  const value = Buffer.alloc(512);
  value.write(name, 0, 100, 'utf8');
  value.write('0000644\0', 100, 8, 'ascii');
  value.write('0000000\0', 108, 8, 'ascii');
  value.write('0000000\0', 116, 8, 'ascii');
  value.write(`${contents.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  value.write('00000000000\0', 136, 12, 'ascii');
  value.fill(0x20, 148, 156);
  value[156] = type.charCodeAt(0);
  value.write('ustar\0', 257, 6, 'ascii');
  let checksum = 0;
  for (const byte of value) checksum += byte;
  value.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return Buffer.concat([value, contents, Buffer.alloc((512 - contents.length % 512) % 512)]);
}

const archive = (...entries) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));

describe('safe registry tar extraction', () => {
  it('extracts only normalized regular files after stripping the package root', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'tw-safe-tar-'));
    await safeExtractTarGz(archive(header('crate-1.0.0/', Buffer.alloc(0), '5'), header('crate-1.0.0/src/lib.rs', Buffer.from('pub fn ok() {}\n'))), destination, { stripComponents: 1 });
    expect(await readFile(join(destination, 'src/lib.rs'), 'utf8')).toBe('pub fn ok() {}\n');
  });

  it.each([
    ['path traversal', header('../outside', Buffer.from('bad'))],
    ['symlink', header('crate/link', Buffer.from('../outside'), '2')],
    ['hardlink', header('crate/link', Buffer.from('../outside'), '1')],
  ])('rejects %s before writing the tree', async (_label, entry) => {
    const destination = await mkdtemp(join(tmpdir(), 'tw-safe-tar-'));
    await expect(safeExtractTarGz(archive(entry), destination)).rejects.toThrow(/unsafe tar archive/u);
  });

  it('rejects duplicate paths and decompression bombs within explicit limits', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'tw-safe-tar-'));
    await expect(safeExtractTarGz(archive(header('same', Buffer.from('a')), header('same', Buffer.from('b'))), destination)).rejects.toThrow(/duplicate path/u);
    await expect(safeExtractTarGz(archive(header('large', Buffer.alloc(2048))), destination, { maxBytes: 1024 })).rejects.toThrow(/exceeded 1024/u);
  });

  it('rejects a regular file used as another entry parent before extraction', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'tw-safe-tar-'));
    await expect(safeExtractTarGz(archive(header('crate/src', Buffer.from('file')), header('crate/src/lib.rs', Buffer.from('nested'))), destination, { stripComponents: 1 })).rejects.toThrow(/regular file is parent/u);
  });

  it('rejects a second archive hidden after the end marker', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'tw-safe-tar-'));
    const concatenated = gzipSync(Buffer.concat([header('safe', Buffer.from('ok')), Buffer.alloc(1024), header('../outside', Buffer.from('bad'))]));
    await expect(safeExtractTarGz(concatenated, destination)).rejects.toThrow(/trailing or concatenated/u);
  });
});
