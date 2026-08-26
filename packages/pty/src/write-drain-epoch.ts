/** Keeps native drain edges tied to the writes they actually completed. */
export class NativeWriteDrainEpoch {
  #generation = 0n;

  admit<T extends Uint8Array>(data: T, write: (data: T) => void): void {
    // Advance only after native admission succeeds. Rejected and zero-length
    // writes therefore leave the JavaScript and native generations aligned.
    write(data);
    if (data.byteLength > 0) this.#generation += 1n;
  }

  isCurrent(generation: bigint): boolean {
    return generation === this.#generation;
  }
}
