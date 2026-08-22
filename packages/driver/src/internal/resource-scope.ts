/** A synchronous or asynchronous resource disposer. */
export type ResourceDisposer = () => void | Promise<void>;

export type ResourceScopeState = 'open' | 'closing' | 'closed';

interface RegisteredResource {
  readonly name: string;
  readonly dispose: ResourceDisposer;
}

/** Exact cleanup ownership failures, preserved after every disposer ran. */
export class ResourceCleanupError extends AggregateError {
  readonly failedResources: readonly string[];

  constructor(scope: string, failures: readonly { readonly name: string; readonly error: unknown }[]) {
    super(
      failures.map(({ name, error }) => new Error(`failed to dispose ${name}`, { cause: error })),
      `${scope} cleanup failed`,
    );
    this.name = 'ResourceCleanupError';
    this.failedResources = Object.freeze(failures.map(({ name }) => name));
  }
}

/**
 * Transactional ownership for resources acquired across asynchronous startup.
 *
 * A disposer is registered in the same turn in which acquisition succeeds, so
 * a later throw cannot strand the resource. Closing is LIFO, attempts every
 * disposer, and is represented by one promise shared by every caller.
 */
export class ResourceScope {
  readonly #name: string;
  readonly #resources: RegisteredResource[] = [];
  readonly #pendingAcquisitions = new Set<Promise<void>>();
  #state: ResourceScopeState = 'open';
  #closePromise: Promise<void> | null = null;

  constructor(name = 'resource scope') {
    this.#name = name;
  }

  get state(): ResourceScopeState {
    return this.#state;
  }

  /** Registers an already-acquired resource for reverse-order cleanup. */
  defer(name: string, dispose: ResourceDisposer): void {
    if (this.#state !== 'open') {
      throw new Error(`${this.#name} is ${this.#state}; cannot register ${name}`);
    }
    this.#resources.push({ name, dispose });
  }

  /**
   * Acquires a resource and owns it before control returns to the caller.
   *
   * If the scope starts closing in the tiny interval while an asynchronous
   * factory is pending, the newly-created value is disposed immediately rather
   * than being returned without an owner.
   */
  async acquire<T>(
    name: string,
    factory: () => T | Promise<T>,
    dispose: (value: T) => void | Promise<void>,
  ): Promise<T> {
    if (this.#state !== 'open') {
      throw new Error(`${this.#name} is ${this.#state}; cannot acquire ${name}`);
    }
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.#pendingAcquisitions.add(pending);
    try {
      const value = await factory();
      if (this.#state !== 'open') {
        await dispose(value);
        throw new Error(`${this.#name} began closing while acquiring ${name}`);
      }
      this.#resources.push({ name, dispose: () => dispose(value) });
      return value;
    } finally {
      finish();
      this.#pendingAcquisitions.delete(pending);
    }
  }

  /** Closes every owned resource once and returns the shared close promise. */
  close(): Promise<void> {
    this.#closePromise ??= this.#closeAll();
    return this.#closePromise;
  }

  async #closeAll(): Promise<void> {
    this.#state = 'closing';
    const failures: { name: string; error: unknown }[] = [];
    try {
      // An acquisition already in flight cannot register after this point. It
      // disposes its value itself, and close waits until that rollback ends.
      await Promise.allSettled([...this.#pendingAcquisitions]);
      for (const resource of this.#resources.reverse()) {
        // allSettled turns synchronous throws and rejected promises into the
        // same cleanup result, while the loop preserves dependency-safe LIFO.
        const [result] = await Promise.allSettled([
          Promise.resolve().then(() => resource.dispose()),
        ]);
        if (result?.status === 'rejected') {
          failures.push({ name: resource.name, error: result.reason });
        }
      }
      this.#resources.length = 0;
    } finally {
      this.#state = 'closed';
    }
    if (failures.length > 0) {
      throw new ResourceCleanupError(this.#name, failures);
    }
  }
}
