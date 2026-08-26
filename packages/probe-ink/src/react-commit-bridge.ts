import type { InkDomElement } from './observe.js';

export const REACT_DEVTOOLS_HOOK = '__REACT_DEVTOOLS_GLOBAL_HOOK__';

export interface ReactRendererMetadata {
  readonly rendererPackageName?: string;
  readonly version?: string;
  readonly reconcilerVersion?: string;
  readonly [key: string]: unknown;
}

export interface ReactFiberRootLike {
  readonly containerInfo?: unknown;
}

export interface ReactCommit {
  readonly rendererId: number;
  readonly renderer: ReactRendererMetadata;
  readonly fiberRoot: ReactFiberRootLike;
  readonly inkRoot: InkDomElement;
  readonly priority?: unknown;
  readonly didError?: boolean;
}

export interface ReactCommitObserver {
  onCommit(commit: ReactCommit): void;
  onUnmount?(rendererId: number, fiber: unknown): void;
}

interface ReactDevToolsHook {
  supportsFiber?: boolean;
  inject?(renderer: ReactRendererMetadata): number;
  onCommitFiberRoot?(
    rendererId: number,
    root: ReactFiberRootLike,
    priority?: unknown,
    didError?: boolean,
  ): void;
  onCommitFiberUnmount?(rendererId: number, fiber: unknown): void;
  readonly [key: string]: unknown;
}

export interface ReactCommitBridge {
  readonly hook: ReactDevToolsHook;
  readonly inkRenderers: ReadonlyMap<number, ReactRendererMetadata>;
  uninstall(): void;
}

/**
 * Installs the smallest hook surface consumed by React reconciler instrumentation.
 *
 * When another observer is present, its object remains the source of all unknown
 * fields and every callback is invoked with its original receiver. Renderer IDs
 * are allocated by that hook, so React and both observers continue to agree.
 */
export function installReactCommitBridge(observer: ReactCommitObserver): ReactCommitBridge {
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const existing = isHook(globals[REACT_DEVTOOLS_HOOK])
    ? globals[REACT_DEVTOOLS_HOOK]
    : undefined;
  const renderers = new Map<number, ReactRendererMetadata>();
  const claimedRendererIds = new Set<number>();
  let nextRendererId = 1;
  let active = true;

  const overlay = Object.create(null) as ReactDevToolsHook;
  Object.defineProperties(overlay, {
    supportsFiber: { configurable: true, enumerable: true, value: true },
    inject: {
      configurable: true,
      enumerable: true,
      value(renderer: ReactRendererMetadata): number {
        const delegated = existing?.inject?.call(existing, renderer);
        if (existing?.inject !== undefined && !isRendererId(delegated)) {
          throw new Error(
            'React renderer instrumentation unavailable: existing hook returned an invalid renderer ID.',
          );
        }
        const rendererId = delegated ?? nextAvailableRendererId(claimedRendererIds, nextRendererId);
        if (!isRendererId(rendererId)) {
          throw new Error('React renderer instrumentation unavailable: renderer ID is invalid.');
        }
        if (!active) return rendererId;
        if (claimedRendererIds.has(rendererId)) {
          throw new Error(
            `React renderer instrumentation unavailable: renderer ID ${rendererId} was reused.`,
          );
        }
        claimedRendererIds.add(rendererId);
        nextRendererId = Math.max(nextRendererId, rendererId + 1);
        if (isInkRenderer(renderer)) renderers.set(rendererId, renderer);
        return rendererId;
      },
    },
    onCommitFiberRoot: {
      configurable: true,
      enumerable: true,
      value(
        rendererId: number,
        root: ReactFiberRootLike,
        priority?: unknown,
        didError?: boolean,
      ): void {
        existing?.onCommitFiberRoot?.call(existing, rendererId, root, priority, didError);
        if (!active) return;
        const renderer = renderers.get(rendererId);
        const inkRoot = asInkRoot(root.containerInfo);
        if (renderer !== undefined && isInkRenderer(renderer) && inkRoot !== undefined) {
          observer.onCommit({
            rendererId,
            renderer,
            fiberRoot: root,
            inkRoot,
            ...(priority === undefined ? {} : { priority }),
            ...(didError === undefined ? {} : { didError }),
          });
        }
      },
    },
    onCommitFiberUnmount: {
      configurable: true,
      enumerable: true,
      value(rendererId: number, fiber: unknown): void {
        existing?.onCommitFiberUnmount?.call(existing, rendererId, fiber);
        if (!active) return;
        const renderer = renderers.get(rendererId);
        if (renderer !== undefined && isInkRenderer(renderer)) {
          observer.onUnmount?.(rendererId, fiber);
        }
      },
    },
  });

  // Unknown DevTools-hook methods belong to the observer that installed them.
  // A prototype-based bridge changes their receiver to the bridge object,
  // which breaks hooks that retain state on `this` (React currently calls
  // methods such as setStrictMode, onScheduleFiberRoot and
  // onPostCommitFiberRoot outside the small surface above). Keep a stable
  // bound delegate for every inherited function and forward unknown writes to
  // the existing hook as well.
  const delegatedFunctions = new Map<PropertyKey, {
    readonly source: (...args: unknown[]) => unknown;
    readonly delegate: (...args: unknown[]) => unknown;
  }>();
  const overlayKeys = new Set<PropertyKey>([
    'supportsFiber',
    'inject',
    'onCommitFiberRoot',
    'onCommitFiberUnmount',
  ]);
  const delegatedValue = (key: PropertyKey, value: unknown): unknown => {
    if (typeof value !== 'function' || existing === undefined) return value;
    const cached = delegatedFunctions.get(key);
    if (cached !== undefined && cached.source === value) return cached.delegate;
    const source = value as (...args: unknown[]) => unknown;
    const delegate = (...args: unknown[]): unknown => Reflect.apply(source, existing, args);
    delegatedFunctions.set(key, { source, delegate });
    return delegate;
  };
  const hook = new Proxy(overlay, {
    get(target, key, receiver) {
      if (Reflect.has(target, key) || existing === undefined) {
        return Reflect.get(target, key, receiver);
      }
      const value = Reflect.get(existing, key, existing);
      return delegatedValue(key, value);
    },
    set(target, key, value, receiver) {
      if (overlayKeys.has(key)) return false;
      return existing === undefined
        ? Reflect.set(target, key, value, receiver)
        : Reflect.set(existing, key, value, existing);
    },
    defineProperty(target, key, descriptor) {
      if (overlayKeys.has(key)) return false;
      return existing === undefined
        ? Reflect.defineProperty(target, key, descriptor)
        : Reflect.defineProperty(existing, key, descriptor);
    },
    deleteProperty(target, key) {
      if (overlayKeys.has(key)) return false;
      return existing === undefined
        ? Reflect.deleteProperty(target, key)
        : Reflect.deleteProperty(existing, key);
    },
    has(target, key) {
      return Reflect.has(target, key) || (existing !== undefined && Reflect.has(existing, key));
    },
    ownKeys(target) {
      return [...new Set([
        ...Reflect.ownKeys(target),
        ...(existing === undefined ? [] : Reflect.ownKeys(existing)),
      ])];
    },
    getOwnPropertyDescriptor(target, key) {
      const own = Reflect.getOwnPropertyDescriptor(target, key);
      if (own !== undefined || existing === undefined) return own;
      const descriptor = Reflect.getOwnPropertyDescriptor(existing, key);
      if (descriptor === undefined) return undefined;

      // Proxy invariants prohibit exposing a non-configurable property that is
      // not also present on the overlay target. Preserve its observable value,
      // enumerability and writability while reporting the virtual view as
      // configurable.
      if ('value' in descriptor) {
        return {
          ...descriptor,
          configurable: true,
          value: delegatedValue(key, descriptor.value),
        };
      }
      const reflected: PropertyDescriptor = {
        configurable: true,
        enumerable: descriptor.enumerable ?? false,
      };
      if (descriptor.get !== undefined) {
        reflected.get = () => Reflect.get(existing, key, existing);
      }
      if (descriptor.set !== undefined) {
        reflected.set = (value: unknown) => Reflect.set(existing, key, value, existing);
      }
      return reflected;
    },
  }) as ReactDevToolsHook;

  globals[REACT_DEVTOOLS_HOOK] = hook;
  return {
    hook,
    inkRenderers: renderers,
    uninstall() {
      if (!active) return;
      active = false;
      renderers.clear();
      claimedRendererIds.clear();
      if (globals[REACT_DEVTOOLS_HOOK] !== hook) return;
      if (existing === undefined) delete globals[REACT_DEVTOOLS_HOOK];
      else globals[REACT_DEVTOOLS_HOOK] = existing;
    },
  };
}

function isRendererId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

/** Runtime capability check; rejects foreign renderer containers fail-closed. */
export function asInkRoot(value: unknown): InkDomElement | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<InkDomElement>;
  return candidate.nodeName === 'ink-root'
    && Array.isArray(candidate.childNodes)
    && candidate.style !== null
    && typeof candidate.style === 'object'
    ? candidate as InkDomElement
    : undefined;
}

export function isInkRenderer(renderer: ReactRendererMetadata): boolean {
  return renderer.rendererPackageName === 'ink';
}

function isHook(value: unknown): value is ReactDevToolsHook {
  return value !== null && typeof value === 'object';
}

function nextAvailableRendererId(
  rendererIds: ReadonlySet<number>,
  start: number,
): number {
  let candidate = start;
  while (rendererIds.has(candidate)) candidate += 1;
  return candidate;
}
