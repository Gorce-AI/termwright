import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, posix } from 'node:path';

const BLOCK = 512;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_FILES = 20_000;

function field(buffer, start, length) {
  const end = buffer.indexOf(0, start);
  return buffer.subarray(start, end >= start && end < start + length ? end : start + length).toString('utf8').trim();
}

function octal(buffer, start, length, label) {
  const value = field(buffer, start, length).replace(/^\s+|\s+$/gu, '');
  if (value === '') return 0;
  if (!/^[0-7]+$/u.test(value)) throw new Error(`unsafe tar archive: invalid ${label}`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`unsafe tar archive: invalid ${label}`);
  return parsed;
}

function normalizedPath(value, stripComponents) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('\0') || isAbsolute(value)) {
    throw new Error('unsafe tar archive path');
  }
  const parts = value.split('/').filter((part) => part !== '');
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('unsafe tar archive path traversal');
  const stripped = parts.slice(stripComponents);
  if (stripped.length === 0) return null;
  const result = stripped.join('/');
  if (posix.normalize(result) !== result) throw new Error('unsafe tar archive path');
  return result;
}

function parsePax(payload) {
  const values = {};
  let offset = 0;
  while (offset < payload.length) {
    const space = payload.indexOf(0x20, offset);
    if (space < 0) throw new Error('unsafe tar archive: malformed PAX record');
    const lengthText = payload.subarray(offset, space).toString('ascii');
    if (!/^[1-9][0-9]*$/u.test(lengthText)) throw new Error('unsafe tar archive: malformed PAX length');
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || offset + length > payload.length || payload[offset + length - 1] !== 0x0a) {
      throw new Error('unsafe tar archive: malformed PAX record');
    }
    const record = payload.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals < 1) throw new Error('unsafe tar archive: malformed PAX value');
    values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

function verifyHeaderChecksum(header) {
  const expected = octal(header, 148, 8, 'checksum');
  let actual = 0;
  for (let index = 0; index < BLOCK; index += 1) actual += index >= 148 && index < 156 ? 0x20 : header[index];
  if (actual !== expected) throw new Error('unsafe tar archive: header checksum mismatch');
}

/**
 * Extract a registry tarball without ever materializing links, devices or an
 * attacker-controlled path. The complete archive is authenticated/validated
 * before the first destination write, so a malformed archive leaves no
 * partial source tree behind.
 */
export async function safeExtractTarGz(bytes, destination, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const stripComponents = options.stripComponents ?? 0;
  if (!Buffer.isBuffer(bytes) || !Number.isSafeInteger(stripComponents) || stripComponents < 0) throw new Error('invalid safe tar extraction options');

  let archive;
  try {
    archive = gunzipSync(bytes, { maxOutputLength: maxBytes });
  } catch (error) {
    throw new Error(`unsafe tar archive: decompression failed or exceeded ${maxBytes} bytes`, { cause: error });
  }

  const entries = [];
  const paths = new Set();
  let offset = 0;
  let localPax = {};
  let globalPax = {};
  let longName;
  let totalFileBytes = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    verifyHeaderChecksum(header);
    const storedSize = octal(header, 124, 12, 'entry size');
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + storedSize;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > archive.length) throw new Error('unsafe tar archive: truncated entry');
    const payload = archive.subarray(dataStart, dataEnd);
    const type = String.fromCharCode(header[156] || 0x30);
    const headerName = [field(header, 345, 155), field(header, 0, 100)].filter(Boolean).join('/');

    if (type === 'x' || type === 'g') {
      const parsed = parsePax(payload);
      if (type === 'x') localPax = parsed;
      else globalPax = { ...globalPax, ...parsed };
    } else if (type === 'L') {
      longName = payload.subarray(0, payload.indexOf(0) >= 0 ? payload.indexOf(0) : payload.length).toString('utf8');
    } else {
      if (type !== '0' && type !== '5') throw new Error(`unsafe tar archive: entry type ${JSON.stringify(type)} is not a regular file or directory`);
      const metadata = { ...globalPax, ...localPax };
      const rawName = metadata.path ?? longName ?? headerName;
      if (metadata.linkpath !== undefined) throw new Error('unsafe tar archive: links are forbidden');
      if (metadata.size !== undefined && Number(metadata.size) !== storedSize) throw new Error('unsafe tar archive: inconsistent PAX entry size');
      const path = normalizedPath(rawName, stripComponents);
      if (path !== null) {
        if (paths.has(path)) throw new Error(`unsafe tar archive: duplicate path ${path}`);
        paths.add(path);
        if (entries.length >= maxFiles) throw new Error(`unsafe tar archive: exceeds ${maxFiles} entries`);
        if (type === '0') {
          totalFileBytes += storedSize;
          if (!Number.isSafeInteger(totalFileBytes) || totalFileBytes > maxBytes) throw new Error(`unsafe tar archive: exceeds ${maxBytes} file bytes`);
        }
        entries.push({ path, type, mode: octal(header, 100, 8, 'mode') & 0o777, payload: type === '0' ? Buffer.from(payload) : undefined });
      }
      localPax = {};
      longName = undefined;
    }
    offset = dataStart + Math.ceil(storedSize / BLOCK) * BLOCK;
  }
  if (offset < archive.length && !archive.subarray(offset).every((byte) => byte === 0)) {
    throw new Error('unsafe tar archive: non-zero trailing or concatenated data');
  }

  const entryTypes = new Map(entries.map((entry) => [entry.path, entry.type]));
  for (const entry of entries) {
    const parts = entry.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      if (entryTypes.get(parts.slice(0, index).join('/')) === '0') {
        throw new Error(`unsafe tar archive: regular file is parent of ${entry.path}`);
      }
    }
  }

  for (const entry of entries.filter((item) => item.type === '5').sort((a, b) => a.path.localeCompare(b.path))) {
    await mkdir(join(destination, entry.path), { recursive: true, mode: entry.mode });
  }
  for (const entry of entries.filter((item) => item.type === '0').sort((a, b) => a.path.localeCompare(b.path))) {
    await mkdir(join(destination, posix.dirname(entry.path)), { recursive: true });
    await writeFile(join(destination, entry.path), entry.payload, { mode: entry.mode });
  }
}
