/**
 * Orders writes after the native callback which observed their cause.
 *
 * Node drains the microtask queue before returning from a Node-API callback.
 * A microtask is therefore still reentrant from the native transport's point
 * of view. `setImmediate` is the first JavaScript boundary which proves that
 * callback has returned to libuv.
 */
export class NativeTurnWriteQueue {
  readonly #write: (data: Buffer) => void;
  readonly #onError: (error: Error) => void;
  readonly #maximumBytes: number;
  readonly #pending: Buffer[] = [];
  #pendingBytes = 0;
  #scheduled: NodeJS.Immediate | undefined;
  #closed = false;

  constructor(
    write: (data: Buffer) => void,
    onError: (error: Error) => void,
    maximumBytes = 8 * 1024 * 1024,
  ) {
    this.#write = write;
    this.#onError = onError;
    this.#maximumBytes = maximumBytes;
  }

  enqueue(data: Uint8Array): void {
    if (this.#closed) throw new Error('ConPTY terminal response queue is closed');
    if (data.byteLength > this.#maximumBytes - this.#pendingBytes) {
      throw new Error(
        `ConPTY terminal response queue capacity exceeded (${this.#maximumBytes} bytes)`,
      );
    }
    const owned = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    this.#pending.push(Buffer.from(owned));
    this.#pendingBytes += owned.byteLength;
    this.#scheduled ??= setImmediate(() => this.#flush());
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#scheduled !== undefined) clearImmediate(this.#scheduled);
    this.#scheduled = undefined;
    this.#pending.length = 0;
    this.#pendingBytes = 0;
  }

  #flush(): void {
    this.#scheduled = undefined;
    if (this.#closed) return;
    while (this.#pending.length > 0) {
      const data = this.#pending.shift()!;
      this.#pendingBytes -= data.byteLength;
      try {
        this.#write(data);
      } catch (error) {
        this.#pending.length = 0;
        this.#pendingBytes = 0;
        this.#onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  }
}
