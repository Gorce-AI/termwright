/** Minimal React renderer instrumentation observer used by the Ink probe spike. */

import type { InkDomElement } from './observe.js';

const BRIDGE = Symbol.for('@termwright/probe-ink/react-commit-bridge.v1');

interface RendererMetadata {
  readonly rendererPackageName?: unknown;
  readonly rendererVersion?: unknown;
}

interface FiberRootLike {
  readonly containerInfo?: unknown;
  readonly current?: FiberLike;
}

interface FiberLike {
  readonly stateNode?: unknown;
  readonly memoizedProps?: unknown;
  readonly child?: FiberLike | null;
  readonly sibling?: FiberLike | null;
}

interface DevToolsHookLike {
  readonly supportsFiber?: boolean;
  inject?(renderer: RendererMetadata): unknown;
  onCommitFiberRoot?(rendererId: unknown, root: FiberRootLike, ...rest: readonly unknown[]): void;
  onCommitFiberUnmount?(rendererId: unknown, fiber: unknown): void;
  [BRIDGE]?: ReactCommitBridge;
  [key: PropertyKey]: unknown;
}

export interface InkRendererRegistration {
  readonly rendererId: unknown;
  readonly packageName: 'ink';
  readonly version?: string;
}

export type InkCommitEvent =
  | {
      readonly type: 'commit';
      readonly renderer: InkRendererRegistration;
      readonly fiberRoot: FiberRootLike;
      readonly root: InkDomElement;
    }
  | {
      readonly type: 'unmount';
      readonly renderer: InkRendererRegistration;
      readonly fiber: unknown;
    }
  | {
      readonly type: 'invalid-root';
      readonly renderer: InkRendererRegistration;
      readonly fiberRoot: FiberRootLike;
      readonly containerInfo: unknown;
    };

export interface InkReconcilerInstrumentation {
  injectIntoDevTools(): unknown;
}

export interface ReactCommitBridgeLease {
  readonly bridge: ReactCommitBridge;
  release(): void;
}

/**
 * Experimental, deliberately Fiber-dependent correlation used to measure
 * which source accessibility props Ink drops from its committed host DOM.
 * It is not used by the production observer or accepted as a stable seam.
 */
export interface InkHostPropCorrelation {
  readonly hostProps?: Readonly<Record<string, unknown>>;
  readonly sourceProps?: Readonly<Record<string, unknown>>;
  readonly accessibleName?: string;
  readonly ariaHidden?: boolean;
}

type Listener = (event: InkCommitEvent) => void;

/**
 * A process-global observer which composes with an already-installed hook.
 * Renderer ids are always the ids returned to React by that hook.
 */
export class ReactCommitBridge {
  readonly #renderers = new Map<unknown, InkRendererRegistration>();
  readonly #roots = new Map<object, InkDomElement>();
  readonly #listeners = new Set<Listener>();
  #nextRendererId = 1;

  register(renderer: RendererMetadata, delegatedId?: unknown): unknown {
    const rendererId = delegatedId === undefined ? this.#nextRendererId++ : delegatedId;
    if (typeof rendererId === 'number' && Number.isInteger(rendererId)) {
      this.#nextRendererId = Math.max(this.#nextRendererId, rendererId + 1);
    }
    if (renderer.rendererPackageName === 'ink') {
      this.#renderers.set(rendererId, {
        rendererId,
        packageName: 'ink',
        ...(typeof renderer.rendererVersion === 'string'
          ? { version: renderer.rendererVersion }
          : {}),
      });
    }
    return rendererId;
  }

  commit(rendererId: unknown, fiberRoot: FiberRootLike): void {
    const renderer = this.#renderers.get(rendererId);
    if (renderer === undefined) return;
    const containerInfo = fiberRoot.containerInfo;
    if (!isInkRoot(containerInfo)) {
      this.#emit({ type: 'invalid-root', renderer, fiberRoot, containerInfo });
      return;
    }
    this.#roots.set(fiberRoot as object, containerInfo);
    this.#emit({ type: 'commit', renderer, fiberRoot, root: containerInfo });
  }

  unmount(rendererId: unknown, fiber: unknown): void {
    const renderer = this.#renderers.get(rendererId);
    if (renderer !== undefined) this.#emit({ type: 'unmount', renderer, fiber });
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  roots(): readonly InkDomElement[] {
    return [...this.#roots.values()];
  }

  hasInkRenderer(): boolean {
    return this.#renderers.size > 0;
  }

  #emit(event: InkCommitEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Instrumentation observers must never break React's commit callback.
      }
    }
  }
}

/** Install or reuse the bridge without replacing the user's hook behavior. */
export function installReactCommitBridge(
  target: typeof globalThis = globalThis,
): ReactCommitBridge {
  const holder = target as typeof globalThis & {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHookLike;
  };
  const existing = holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const installed = existing?.[BRIDGE];
  if (installed !== undefined) return installed;

  const bridge = new ReactCommitBridge();
  const hook = Object.create(existing ?? null) as DevToolsHookLike;
  Object.defineProperties(hook, {
    supportsFiber: { value: true, enumerable: true, configurable: true },
    inject: {
      configurable: true,
      value(renderer: RendererMetadata): unknown {
        const delegatedId = existing?.inject?.call(existing, renderer);
        return bridge.register(renderer, delegatedId);
      },
    },
    onCommitFiberRoot: {
      configurable: true,
      value(rendererId: unknown, root: FiberRootLike, ...rest: readonly unknown[]): void {
        try {
          existing?.onCommitFiberRoot?.call(existing, rendererId, root, ...rest);
        } finally {
          bridge.commit(rendererId, root);
        }
      },
    },
    onCommitFiberUnmount: {
      configurable: true,
      value(rendererId: unknown, fiber: unknown): void {
        try {
          existing?.onCommitFiberUnmount?.call(existing, rendererId, fiber);
        } finally {
          bridge.unmount(rendererId, fiber);
        }
      },
    },
    [BRIDGE]: { value: bridge },
  });
  try {
    const descriptor = Object.getOwnPropertyDescriptor(holder, '__REACT_DEVTOOLS_GLOBAL_HOOK__');
    if (
      descriptor?.configurable === true &&
      (('writable' in descriptor && descriptor.writable === false) ||
        (!('writable' in descriptor) && descriptor.set === undefined))
    ) {
      Object.defineProperty(holder, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
        value: hook,
        writable: true,
        enumerable: descriptor.enumerable ?? false,
        configurable: true,
      });
    } else {
      holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
    }
  } catch (cause) {
    throw new Error(
      'Ink semantic probe unavailable: the existing React renderer instrumentation hook cannot be composed.',
      { cause },
    );
  }
  return bridge;
}

interface BridgeLeaseRecord {
  readonly bridge: ReactCommitBridge;
  readonly hook: DevToolsHookLike;
  readonly priorDescriptor?: PropertyDescriptor;
  references: number;
}

const bridgeLeases = new WeakMap<object, BridgeLeaseRecord>();

/**
 * Acquire a process-hook lease for transactional adapter setup. The final
 * release restores the exact prior property descriptor, but only while our
 * hook is still current. A bridge installed independently is never removed.
 */
export function acquireReactCommitBridge(
  target: typeof globalThis = globalThis,
): ReactCommitBridgeLease {
  const holder = target as typeof globalThis & {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHookLike;
  };
  const currentRecord = bridgeLeases.get(target);
  if (currentRecord !== undefined && holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ === currentRecord.hook) {
    currentRecord.references += 1;
    return leaseFor(target, currentRecord);
  }

  const existingBridge = holder.__REACT_DEVTOOLS_GLOBAL_HOOK__?.[BRIDGE];
  const priorDescriptor = Object.getOwnPropertyDescriptor(holder, '__REACT_DEVTOOLS_GLOBAL_HOOK__');
  const bridge = installReactCommitBridge(target);
  const hook = holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook === undefined) {
    throw new Error(
      'Ink semantic probe unavailable: React renderer instrumentation hook installation disappeared.',
    );
  }
  // If another subsystem installed this bridge, this adapter may subscribe to
  // it but must not claim ownership of the process-global hook.
  if (existingBridge !== undefined) return { bridge, release() {} };
  const record: BridgeLeaseRecord = {
    bridge,
    hook,
    ...(priorDescriptor === undefined ? {} : { priorDescriptor }),
    references: 1,
  };
  bridgeLeases.set(target, record);
  return leaseFor(target, record);
}

function leaseFor(target: typeof globalThis, record: BridgeLeaseRecord): ReactCommitBridgeLease {
  let released = false;
  return {
    bridge: record.bridge,
    release() {
      if (released) return;
      released = true;
      record.references -= 1;
      if (record.references > 0) return;
      bridgeLeases.delete(target);
      const holder = target as typeof globalThis & {
        __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHookLike;
      };
      if (holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== record.hook) return;
      if (record.priorDescriptor === undefined) {
        delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      } else {
        Object.defineProperty(holder, '__REACT_DEVTOOLS_GLOBAL_HOOK__', record.priorDescriptor);
      }
    },
  };
}

const activatedReconcilers = new WeakMap<object, WeakSet<object>>();

/**
 * Enable Ink's existing reconciler seam directly. This intentionally does not
 * set DEV and therefore cannot load the DevTools UI/backend or open a socket.
 */
export function activateInkRendererObservation(
  reconciler: InkReconcilerInstrumentation,
  target: typeof globalThis = globalThis,
): ReactCommitBridge {
  const bridge = installReactCommitBridge(target);
  let bridges = activatedReconcilers.get(reconciler);
  if (bridges === undefined) {
    bridges = new WeakSet<object>();
    activatedReconcilers.set(reconciler, bridges);
  }
  if (!bridges.has(bridge)) {
    // React 19's reconciler currently returns false even after synchronously
    // calling hook.inject(). Registration, not that implementation-detail
    // return value, is the capability proof.
    reconciler.injectIntoDevTools();
    if (!bridge.hasInkRenderer())
      throw new Error(
        'Ink semantic probe unavailable: React renderer instrumentation did not register Ink.',
      );
    bridges.add(bridge);
  }
  return bridge;
}

/**
 * Correlate committed Ink host objects with the nearest source component
 * props. This POC proves that `aria-label`/`aria-hidden`, which Ink omits from
 * normal-mode host DOM, remain recoverable through Fiber. The returned map is
 * a measurement aid, not a production contract: every field is structural
 * React internals and must fail absent rather than fabricate data.
 */
export function correlateInkHostProps(
  fiberRoot: FiberRootLike,
  options: { readonly maxFibers?: number } = {},
): ReadonlyMap<InkDomElement, InkHostPropCorrelation> {
  const correlations = new Map<InkDomElement, InkHostPropCorrelation>();
  const maxFibers = options.maxFibers ?? 100_000;
  let visitedFibers = 0;
  const walk = (
    fiber: FiberLike | null | undefined,
    candidateSourceProps?: Readonly<Record<string, unknown>>,
  ): void => {
    for (
      let current = fiber;
      current !== null && current !== undefined;
      current = current.sibling
    ) {
      visitedFibers += 1;
      if (visitedFibers > maxFibers) {
        throw new Error(
          'Ink Fiber accessibility correlation exceeded its bounded traversal limit.',
        );
      }
      const props = record(current.memoizedProps);
      const sourceProps = hasAccessibilitySourceProps(props) ? props : candidateSourceProps;
      if (isInkElement(current.stateNode)) {
        correlations.set(current.stateNode, {
          ...(props === undefined ? {} : { hostProps: props }),
          ...(sourceProps === undefined ? {} : { sourceProps }),
          ...(typeof sourceProps?.['aria-label'] === 'string'
            ? { accessibleName: sourceProps['aria-label'] }
            : {}),
          ...(typeof sourceProps?.['aria-hidden'] === 'boolean'
            ? { ariaHidden: sourceProps['aria-hidden'] }
            : {}),
        });
        walk(current.child, undefined);
      } else {
        walk(current.child, sourceProps);
      }
    }
  };
  walk(fiberRoot.current?.child);
  return correlations;
}

/** Fail closed instead of accepting a foreign or incomplete committed root. */
export function requireCommittedInkRoot(event: InkCommitEvent): InkDomElement {
  if (event.type !== 'commit') {
    throw new Error(
      'Ink semantic probe unavailable: React renderer instrumentation did not expose expected committed Ink root.',
    );
  }
  return event.root;
}

function isInkRoot(value: unknown): value is InkDomElement {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    readonly nodeName?: unknown;
    readonly childNodes?: unknown;
  };
  return candidate.nodeName === 'ink-root' && Array.isArray(candidate.childNodes);
}

function isInkElement(value: unknown): value is InkDomElement {
  if (typeof value !== 'object' || value === null) return false;
  const nodeName = (value as { readonly nodeName?: unknown }).nodeName;
  return (
    nodeName === 'ink-root' ||
    nodeName === 'ink-box' ||
    nodeName === 'ink-text' ||
    nodeName === 'ink-virtual-text'
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function hasAccessibilitySourceProps(
  props: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return (
    props !== undefined &&
    (Object.hasOwn(props, 'aria-label') ||
      Object.hasOwn(props, 'aria-hidden') ||
      Object.hasOwn(props, 'aria-role') ||
      Object.hasOwn(props, 'aria-state'))
  );
}
