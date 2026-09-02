import { createHash, type Hash } from 'node:crypto';
import { open, mkdir, mkdtemp, rename, rm, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { TraceError } from './errors.js';
import { TRACE_FILES, TRACE_INCOMPLETE_FILE } from './types.js';

interface PendingAppend {
  readonly name: string;
  readonly body: string;
  readonly bytes: number;
}

export interface AppendSpoolOptions {
  readonly target: string;
  readonly initial: Readonly<Record<string, string>>;
  readonly maxPendingRecords: number;
  readonly maxPendingBytes: number;
}

export interface AppendSpoolUsage {
  /** Bytes in canonical trace members, excluding the private incomplete marker. */
  readonly bytes: number;
  /** Exact high-water bytes held by this writer's private staging trace. */
  readonly tempDiskPeakBytes: number;
  readonly fileBytes: Readonly<Record<string, number>>;
}

export interface AppendSpoolCommit extends AppendSpoolUsage {
  readonly dir: string;
}

/**
 * A bounded, sequential append queue backed by a private staging directory.
 *
 * Admission is synchronous so event emitters never create one promise per
 * record. Disk writes are serialized by the single drain loop and every hash
 * is advanced from exactly the bytes handed to the file handle.
 */
export class AppendSpool {
  readonly #target: string;
  readonly #maxPendingRecords: number;
  readonly #maxPendingBytes: number;
  readonly #initialization: Promise<void>;
  readonly #handles = new Map<string, FileHandle>();
  readonly #hashes = new Map<string, Hash>();
  readonly #writtenBytes = new Map<string, number>();
  readonly #queue: PendingAppend[] = [];
  #head = 0;
  #pendingBytes = 0;
  #draining: Promise<void> | null = null;
  #failure: unknown;
  #staging: string | undefined;
  #incompleteBytes = 0;
  #tempDiskPeakBytes = 0;
  #sealed = false;

  constructor(options: AppendSpoolOptions) {
    this.#target = resolve(options.target);
    this.#maxPendingRecords = options.maxPendingRecords;
    this.#maxPendingBytes = options.maxPendingBytes;
    this.#initialization = this.#initialize(options.initial).catch((error: unknown) => {
      this.#failure = error;
    });
  }

  enqueue(name: string, body: string): void {
    if (this.#sealed) throw new TraceError('session-closed', 'trace spool is sealed');
    if (this.#failure !== undefined) return;
    const bytes = Buffer.byteLength(body, 'utf8');
    const pendingRecords = this.#queue.length - this.#head;
    if (
      bytes > this.#maxPendingBytes ||
      pendingRecords >= this.#maxPendingRecords ||
      this.#pendingBytes + bytes > this.#maxPendingBytes
    ) {
      this.#failure = new TraceError(
        'capacity',
        `trace append backlog exceeded ${this.#maxPendingRecords} records or ${this.#maxPendingBytes} bytes`,
        { suggestion: 'Reduce artifact volume or raise the explicit trace pending limits.' },
      );
      return;
    }
    this.#queue.push({ name, body, bytes });
    this.#pendingBytes += bytes;
    this.#startDrain();
  }

  async commit(finalFiles: Readonly<Record<string, string>>): Promise<AppendSpoolCommit> {
    this.#sealed = true;
    await this.#initialization;
    await this.#draining;
    if (this.#failure !== undefined) {
      await this.#abortFiles();
      throw this.#failure;
    }
    for (const [name, body] of Object.entries(finalFiles)) await this.#writeFinal(name, body);
    for (const handle of this.#handles.values()) await handle.sync();
    await this.#closeHandles();

    const staging = this.#requireStaging();
    // Resolve a conflicting destination before consuming the incremental hash
    // objects or writing the validity marker. A caller can then remove an
    // occupied target and retry publication without replaying the run.
    await clearEmptyTarget(this.#target);
    await unlink(join(staging, TRACE_INCOMPLETE_FILE)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    this.#incompleteBytes = 0;
    const checksums = Object.fromEntries(
      [...this.#hashes.entries()].map(([name, hash]) => [name, hash.copy().digest('hex')]),
    );
    const commitBody = `${JSON.stringify({ v: 4, checksums })}\n`;
    await durableWrite(join(staging, TRACE_FILES.commit), commitBody, true);
    this.#writtenBytes.set(TRACE_FILES.commit, Buffer.byteLength(commitBody, 'utf8'));
    this.#recordDiskHighWater();
    await fsyncDirectory(staging);
    await rename(staging, this.#target);
    this.#staging = undefined;
    await fsyncDirectory(dirname(this.#target));
    return Object.freeze({ dir: this.#target, ...this.#usage() });
  }

  async abort(): Promise<AppendSpoolUsage> {
    this.#sealed = true;
    await this.#initialization;
    await this.#draining;
    const usage = this.#usage();
    await this.#abortFiles();
    return usage;
  }

  #startDrain(): void {
    if (this.#draining !== null) return;
    this.#draining = this.#drain().finally(() => {
      this.#draining = null;
      if (this.#head < this.#queue.length && this.#failure === undefined) this.#startDrain();
    });
  }

  async #drain(): Promise<void> {
    await this.#initialization;
    while (this.#head < this.#queue.length && this.#failure === undefined) {
      const items: PendingAppend[] = [];
      let batchBytes = 0;
      while (this.#head < this.#queue.length && items.length < 128 && batchBytes < 1024 * 1024) {
        const item = this.#queue[this.#head++];
        if (item === undefined) break;
        items.push(item);
        batchBytes += item.bytes;
      }
      try {
        const batches = new Map<string, string[]>();
        for (const item of items) {
          const bodies = batches.get(item.name) ?? [];
          bodies.push(item.body);
          batches.set(item.name, bodies);
        }
        for (const [name, bodies] of batches) {
          const handle = this.#handles.get(name);
          const hash = this.#hashes.get(name);
          if (handle === undefined || hash === undefined) {
            throw new TraceError('protocol-violation', `unknown trace stream ${name}`);
          }
          const body = bodies.join('');
          hash.update(body);
          await handle.write(body, null, 'utf8');
          this.#writtenBytes.set(
            name,
            (this.#writtenBytes.get(name) ?? 0) + Buffer.byteLength(body, 'utf8'),
          );
          this.#recordDiskHighWater();
        }
      } catch (error) {
        this.#failure = error;
      } finally {
        this.#pendingBytes -= batchBytes;
      }
      if (this.#head >= 1024 && this.#head * 2 >= this.#queue.length) {
        this.#queue.splice(0, this.#head);
        this.#head = 0;
      }
    }
  }

  async #initialize(initial: Readonly<Record<string, string>>): Promise<void> {
    const parent = dirname(this.#target);
    await mkdir(parent, { recursive: true });
    this.#staging = await mkdtemp(join(parent, `.${basename(this.#target)}.staging-`));
    const incompleteBody = `${JSON.stringify({ v: 4, target: this.#target })}\n`;
    await durableWrite(join(this.#staging, TRACE_INCOMPLETE_FILE), incompleteBody);
    this.#incompleteBytes = Buffer.byteLength(incompleteBody, 'utf8');
    this.#recordDiskHighWater();
    for (const [name, body] of Object.entries(initial)) {
      const handle = await open(join(this.#staging, name), 'wx');
      this.#handles.set(name, handle);
      const hash = createHash('sha256');
      this.#hashes.set(name, hash);
      this.#writtenBytes.set(name, 0);
      if (body !== '') {
        hash.update(body);
        await handle.write(body, null, 'utf8');
        this.#writtenBytes.set(name, Buffer.byteLength(body, 'utf8'));
        this.#recordDiskHighWater();
      }
    }
  }

  async #writeFinal(name: string, body: string): Promise<void> {
    if (this.#handles.has(name)) {
      throw new TraceError('protocol-violation', `trace final file ${name} is already appendable`);
    }
    const staging = this.#requireStaging();
    await durableWrite(join(staging, name), body, true);
    this.#hashes.set(name, createHash('sha256').update(body));
    this.#writtenBytes.set(name, Buffer.byteLength(body, 'utf8'));
    this.#recordDiskHighWater();
  }

  #usage(): AppendSpoolUsage {
    const fileBytes = Object.freeze(Object.fromEntries(this.#writtenBytes));
    return Object.freeze({
      bytes: Object.values(fileBytes).reduce((total, value) => total + value, 0),
      tempDiskPeakBytes: this.#tempDiskPeakBytes,
      fileBytes,
    });
  }

  #recordDiskHighWater(): void {
    const bytes =
      this.#incompleteBytes +
      [...this.#writtenBytes.values()].reduce((total, value) => total + value, 0);
    this.#tempDiskPeakBytes = Math.max(this.#tempDiskPeakBytes, bytes);
  }

  #requireStaging(): string {
    if (this.#staging === undefined)
      throw new TraceError('session-closed', 'trace spool is closed');
    return this.#staging;
  }

  async #closeHandles(): Promise<void> {
    const handles = [...this.#handles.values()];
    this.#handles.clear();
    await Promise.allSettled(handles.map((handle) => handle.close()));
  }

  async #abortFiles(): Promise<void> {
    await this.#closeHandles();
    if (this.#staging !== undefined) {
      await rm(this.#staging, { recursive: true, force: true });
      this.#staging = undefined;
    }
  }
}

async function durableWrite(path: string, body: string, replace = false): Promise<void> {
  const handle = await open(path, replace ? 'w' : 'wx');
  try {
    await handle.writeFile(body, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function clearEmptyTarget(target: string): Promise<void> {
  try {
    await rmdir(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'EPERM' || code === 'EACCES') {
      throw new TraceError(
        'protocol-violation',
        `trace target ${target} already holds content; refusing to replace it`,
      );
    }
    throw error;
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  } finally {
    await handle?.close();
  }
}
