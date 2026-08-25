/** Maximum output retained between native PTY spawn and journal subscription. */
export const MAX_EARLY_PTY_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Startup cannot continue because doing so would require silently losing PTY bytes. */
export class EarlyPtyOutputOverflowError extends Error {
  override readonly name = 'EarlyPtyOutputOverflowError';

  constructor(readonly observedBytes: number) {
    super(
      `PTY emitted more than ${MAX_EARLY_PTY_OUTPUT_BYTES} bytes before its output journal was attached ` +
      `(observed at least ${observedBytes}); session startup was aborted without dropping bytes`,
    );
  }
}

/** Bounded, one-shot handoff from a synchronously-emitting backend to the session journal. */
export class EarlyPtyOutput {
  readonly #chunks: Uint8Array[] = [];
  #bytes = 0;
  #error: EarlyPtyOutputOverflowError | undefined;

  push(data: Uint8Array): void {
    this.#bytes += data.byteLength;
    if (this.#bytes > MAX_EARLY_PTY_OUTPUT_BYTES) {
      this.#chunks.length = 0;
      this.#error ??= new EarlyPtyOutputOverflowError(this.#bytes);
      return;
    }
    if (this.#error === undefined) this.#chunks.push(data);
  }

  drain(consumer: (data: Uint8Array) => void): void {
    if (this.#error !== undefined) throw this.#error;
    const buffered = this.#chunks.splice(0);
    this.#bytes = 0;
    for (const data of buffered) consumer(data);
  }
}
