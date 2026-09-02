/** Fixed-capacity FIFO retention with O(1) eviction. */
export class BoundedRing<T> {
  readonly #values: Array<T | undefined>;
  #start = 0;
  #size = 0;

  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new TypeError('ring capacity must be a positive safe integer');
    }
    this.#values = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.#size;
  }

  push(value: T): void {
    if (this.#size < this.capacity) {
      this.#values[(this.#start + this.#size) % this.capacity] = value;
      this.#size += 1;
      return;
    }
    this.#values[this.#start] = value;
    this.#start = (this.#start + 1) % this.capacity;
  }

  toArray(): T[] {
    const result = new Array<T>(this.#size);
    for (let index = 0; index < this.#size; index += 1) {
      result[index] = this.#values[(this.#start + index) % this.capacity]!;
    }
    return result;
  }

  tail(limit: number): T[] {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new TypeError('ring tail limit must be a non-negative safe integer');
    }
    const count = Math.min(limit, this.#size);
    const result = new Array<T>(count);
    const offset = this.#size - count;
    for (let index = 0; index < count; index += 1) {
      result[index] = this.#values[(this.#start + offset + index) % this.capacity]!;
    }
    return result;
  }
}
