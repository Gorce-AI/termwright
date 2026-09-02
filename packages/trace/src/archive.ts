/**
 * Archive storage: a `.twtrace` is either a directory or a zip of that
 * directory's four files. {@link openArchive} hides the difference behind one
 * line-oriented interface so readers never branch on the container.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { unzipSync, Zip, ZipDeflate } from 'fflate';
import { TraceError } from './errors.js';
import { TRACE_FILES } from './types.js';

/** Line-oriented access to the files of one archive. */
export interface ArchiveFiles {
  /** `'directory'` or `'zip'` — reported by the reader for diagnostics. */
  readonly container: 'directory' | 'zip';
  /** Path the archive was opened from. */
  readonly path: string;
  has(name: string): Promise<boolean>;
  /** Whole-file read; use {@link ArchiveFiles.lines} for the large ones. */
  read(name: string): Promise<string>;
  /** Streams exact member bytes for verification and packaging. */
  bytes(name: string): AsyncIterable<Uint8Array>;
  /** Streams non-empty lines, without trailing newlines. */
  lines(name: string): AsyncIterable<string>;
  close(): Promise<void>;
}

const ARCHIVE_MEMBERS = Object.values(TRACE_FILES);

/** Maximum accepted zip size; guards against decompression blowups. */
const MAX_ZIP_BYTES = 512 * 1024 * 1024;

/**
 * Opens an archive from a directory path or a zip file path.
 *
 * @throws TraceError `not-found` when nothing is there, or when what is there
 *   is not a `.twtrace` at all — both mean the caller named the wrong thing.
 * @throws TraceError `protocol-violation` when it *is* an archive and is
 *   broken: unreadable zip, missing member, malformed `meta.json`.
 */
export async function openArchive(path: string): Promise<ArchiveFiles> {
  const info = await stat(path).catch(() => null);
  if (info === null) {
    throw new TraceError('not-found', `trace not found: ${path}`, {
      suggestion: 'Pass a .twtrace directory or a zipped .twtrace file.',
    });
  }
  const files = info.isDirectory() ? openDirectory(path) : await openZip(path);
  if (!(await files.has(TRACE_FILES.meta))) {
    await files.close();
    // Something is there, but it is not one of ours: the caller pointed at the
    // wrong directory, not at a damaged recording.
    throw new TraceError('not-found', `${path} is not a .twtrace archive`, {
      suggestion: `Expected ${TRACE_FILES.meta} inside the archive.`,
    });
  }
  return files;
}

function openDirectory(dir: string): ArchiveFiles {
  return {
    container: 'directory',
    path: dir,
    async has(name) {
      return (await stat(join(dir, name)).catch(() => null)) !== null;
    },
    async read(name) {
      return readFile(join(dir, name), 'utf8');
    },
    bytes(name) {
      return createReadStream(join(dir, name));
    },
    lines(name) {
      return streamLines(join(dir, name));
    },
    async close() {
      /* nothing to release */
    },
  };
}

async function openZip(file: string): Promise<ArchiveFiles> {
  const raw = await readFile(file);
  if (raw.byteLength > MAX_ZIP_BYTES) {
    throw new TraceError('capacity', `${file} exceeds the ${MAX_ZIP_BYTES} byte archive limit`);
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(raw));
  } catch (cause) {
    // Stays `protocol-violation`, deliberately. The file exists, so
    // `not-found` would be false — and the costs are asymmetric: telling
    // someone to check their path when they are actually holding a truncated
    // CI artifact sends them to the wrong place, while the reverse mistake
    // only makes them look twice at a path they can see is wrong.
    throw new TraceError('protocol-violation', `${file} is not a readable zip archive`, {
      suggestion: cause instanceof Error ? cause.message : undefined,
    });
  }
  // Tolerate archives that were zipped with the directory itself as a prefix.
  const flattened = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    flattened.set(basename(name), bytes);
  }
  const decoder = new TextDecoder('utf-8');
  const text = (name: string): string => {
    const bytes = flattened.get(name);
    if (bytes === undefined) {
      throw new TraceError('protocol-violation', `${file}: missing archive member ${name}`);
    }
    return decoder.decode(bytes);
  };
  return {
    container: 'zip',
    path: file,
    async has(name) {
      return flattened.has(name);
    },
    async read(name) {
      return text(name);
    },
    async *bytes(name) {
      const value = flattened.get(name);
      if (value !== undefined) yield value;
    },
    lines(name) {
      return iterateLines(flattened.has(name) ? text(name) : '');
    },
    async close() {
      flattened.clear();
    },
  };
}

async function* streamLines(path: string): AsyncGenerator<string> {
  const exists = (await stat(path).catch(() => null)) !== null;
  if (!exists) return;
  const stream = createReadStream(path, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (line.trim() !== '') yield line;
    }
  } finally {
    reader.close();
    stream.destroy();
  }
}

async function* iterateLines(text: string): AsyncGenerator<string> {
  for (const line of text.split('\n')) {
    if (line.trim() !== '') yield line;
  }
}

/**
 * Zips an archive directory into a single file.
 *
 * @param dir - the `.twtrace` directory produced by {@link TraceWriter.finalize}
 * @param outFile - destination path, conventionally `<name>.twtrace.zip`
 * @returns the number of bytes written
 */
export async function packTrace(dir: string, outFile: string): Promise<number> {
  const committed = (await stat(join(dir, TRACE_FILES.commit)).catch(() => null)) !== null;
  if (!committed) {
    const hasMeta = (await stat(join(dir, TRACE_FILES.meta)).catch(() => null)) !== null;
    throw new TraceError(
      hasMeta ? 'protocol-violation' : 'not-found',
      hasMeta ? `${dir} is an incomplete .twtrace archive` : `${dir} is not a .twtrace archive`,
      {
        suggestion: hasMeta
          ? `Only atomically published archives containing ${TRACE_FILES.commit} can be packed.`
          : `Expected ${TRACE_FILES.meta} and ${TRACE_FILES.commit} inside the archive.`,
      },
    );
  }
  const output = createWriteStream(outFile, { flags: 'wx' });
  let written = 0;
  let streamError: unknown;
  const zip = new Zip((error, data, final) => {
    if (error !== null) {
      streamError = error;
      output.destroy(error);
      return;
    }
    written += data.byteLength;
    output.write(data);
    if (final) output.end();
  });
  try {
    for (const member of ARCHIVE_MEMBERS) {
      const path = join(dir, member);
      const info = await stat(path).catch(() => null);
      if (info === null) continue;
      const entry = new ZipDeflate(member, { level: 6 });
      zip.add(entry);
      for await (const chunk of createReadStream(path)) {
        entry.push(new Uint8Array(chunk), false);
        if (output.writableNeedDrain) await once(output, 'drain');
      }
      entry.push(new Uint8Array(0), true);
    }
    zip.end();
    await once(output, 'finish');
    if (streamError !== undefined) throw streamError;
    return written;
  } catch (error) {
    zip.terminate();
    output.destroy();
    throw error;
  }
}

/**
 * Extracts a zipped archive into `destDir`.
 *
 * @returns the names of the extracted members
 */
export async function unpackTrace(file: string, destDir: string): Promise<readonly string[]> {
  const files = await openZip(file);
  await mkdir(destDir, { recursive: true });
  const written: string[] = [];
  for (const member of ARCHIVE_MEMBERS) {
    if (!(await files.has(member))) continue;
    await writeFile(join(destDir, member), await files.read(member), 'utf8');
    written.push(member);
  }
  await files.close();
  return written;
}
