/** A resource that can be owned by a test or scenario scope. */
export interface DisposableResource {
  close?: () => unknown | Promise<unknown>;
  dispose?: () => unknown | Promise<unknown>;
  [Symbol.dispose]?: () => unknown;
  [Symbol.asyncDispose]?: () => unknown | Promise<unknown>;
}

export interface ResourceScopeOptions {
  /** Aborting this signal starts scope cleanup. */
  readonly signal?: AbortSignal;
}

/** Raised when an acquisition completes after its owning scope started closing. */
export class ResourceScopeClosedError extends Error {
  constructor() {
    super('The resource scope closed before the resource was acquired');
    this.name = 'ResourceScopeClosedError';
  }
}

/**
 * Test-owned resources with deterministic LIFO teardown.
 *
 * An acquisition reserves its cleanup position before its asynchronous factory
 * starts. This closes the usual timeout race: a resource that appears after the
 * test has begun tearing down is still disposed before `close()` resolves.
 */
export interface ResourceScope {
  readonly signal: AbortSignal;
  readonly closed: boolean;
  defer(cleanup: () => unknown | Promise<unknown>): void;
  use<T extends DisposableResource>(resource: T): T;
  acquire<T extends DisposableResource>(
    factory: (signal: AbortSignal) => T | Promise<T>,
  ): Promise<T>;
  child(): ResourceScope;
  close(): Promise<void>;
}

interface CleanupSlot {
  run(): Promise<void>;
}

function cleanupFor(resource: DisposableResource): () => unknown | Promise<unknown> {
  if (typeof resource[Symbol.asyncDispose] === 'function') {
    return () => resource[Symbol.asyncDispose]!();
  }
  if (typeof resource[Symbol.dispose] === 'function') return () => resource[Symbol.dispose]!();
  if (typeof resource.close === 'function') return () => resource.close!();
  if (typeof resource.dispose === 'function') return () => resource.dispose!();
  throw new TypeError(
    'resources.use() needs a close(), dispose(), Symbol.dispose, or Symbol.asyncDispose resource',
  );
}

function once(cleanup: () => unknown | Promise<unknown>): CleanupSlot {
  let result: Promise<void> | undefined;
  return {
    run(): Promise<void> {
      result ??= Promise.resolve()
        .then(cleanup)
        .then(() => undefined);
      return result;
    },
  };
}

/** Creates a scope suitable for fixtures, hooks, sidecars, and late acquisitions. */
export function createResourceScope(options: ResourceScopeOptions = {}): ResourceScope {
  const controller = new AbortController();
  const slots: CleanupSlot[] = [];
  let closed = false;
  let closing: Promise<void> | undefined;

  const parent = options.signal;
  const abortFromParent = (): void => {
    controller.abort(parent?.reason);
    void scope.close().catch(() => undefined);
  };

  const register = (slot: CleanupSlot): void => {
    if (closed) throw new ResourceScopeClosedError();
    slots.push(slot);
  };

  const scope: ResourceScope = {
    get signal(): AbortSignal {
      return controller.signal;
    },
    get closed(): boolean {
      return closed;
    },
    defer(cleanup): void {
      if (typeof cleanup !== 'function') throw new TypeError('resources.defer() needs a function');
      register(once(cleanup));
    },
    use<T extends DisposableResource>(resource: T): T {
      if ((typeof resource !== 'object' && typeof resource !== 'function') || resource === null) {
        throw new TypeError('resources.use() needs a disposable resource');
      }
      register(once(cleanupFor(resource)));
      return resource;
    },
    async acquire<T extends DisposableResource>(
      factory: (signal: AbortSignal) => T | Promise<T>,
    ): Promise<T> {
      if (typeof factory !== 'function') throw new TypeError('resources.acquire() needs a factory');
      if (closed) throw new ResourceScopeClosedError();

      // Start through a promise so the slot exists before user code can settle.
      const acquired = Promise.resolve().then(() => factory(controller.signal));
      const slot = once(async () => {
        let resource: T;
        try {
          resource = await acquired;
        } catch {
          // The caller owns an acquisition failure; there is no resource to clean.
          return;
        }
        await cleanupFor(resource)();
      });
      register(slot);

      const resource = await acquired;
      if (closed) {
        await slot.run();
        throw new ResourceScopeClosedError();
      }
      return resource;
    },
    child(): ResourceScope {
      const child = createResourceScope({ signal: controller.signal });
      try {
        register(once(() => child.close()));
      } catch (error) {
        void child.close().catch(() => undefined);
        throw error;
      }
      return child;
    },
    close(): Promise<void> {
      if (closing !== undefined) return closing;
      closed = true;
      controller.abort(new ResourceScopeClosedError());
      parent?.removeEventListener('abort', abortFromParent);
      closing = (async () => {
        const errors: unknown[] = [];
        for (const slot of slots.toReversed()) {
          try {
            await slot.run();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1)
          throw new AggregateError(errors, 'Multiple resource cleanups failed');
      })();
      return closing;
    },
  };

  if (parent?.aborted === true) abortFromParent();
  else parent?.addEventListener('abort', abortFromParent, { once: true });
  return Object.freeze(scope);
}
