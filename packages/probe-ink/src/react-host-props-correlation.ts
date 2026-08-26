import type { InkDomElement } from './observe.js';

export interface ReactFiberLike {
  readonly child?: ReactFiberLike | null;
  readonly sibling?: ReactFiberLike | null;
  readonly stateNode?: unknown;
  readonly memoizedProps?: unknown;
}

export interface ReactFiberRootWithCurrent {
  readonly current?: ReactFiberLike | null;
}

export const INK_HOST_PROPS_CORRELATION_DIAGNOSTIC =
  'Ink semantic probe unavailable: committed React fibers did not correlate uniquely with the Ink host tree.';

/**
 * Experimental, commit-local correlation only. Ink DOM remains the traversal
 * source; Fiber supplies props solely for the exact live host objects in it.
 */
export function correlateInkHostProps(
  fiberRoot: ReactFiberRootWithCurrent,
  inkRoot: InkDomElement,
): ReadonlyMap<InkDomElement, Readonly<Record<string, unknown>>> {
  const current = fiberRoot.current;
  if (current === undefined || current === null) failCorrelation();

  const hosts = collectLiveElementHosts(inkRoot);
  const correlated = new Map<InkDomElement, Readonly<Record<string, unknown>>>();
  const stack: ReactFiberLike[] = [current];
  const visited = new Set<ReactFiberLike>();

  while (stack.length > 0) {
    const fiber = stack.pop();
    if (fiber === undefined || visited.has(fiber)) failCorrelation();
    visited.add(fiber);

    const host = fiber.stateNode;
    if (hosts.has(host as InkDomElement)) {
      if (correlated.has(host as InkDomElement) || !isProps(fiber.memoizedProps)) {
        failCorrelation();
      }
      correlated.set(host as InkDomElement, fiber.memoizedProps);
    }
    if (fiber.sibling !== undefined && fiber.sibling !== null) stack.push(fiber.sibling);
    if (fiber.child !== undefined && fiber.child !== null) stack.push(fiber.child);
  }

  if (correlated.size !== hosts.size) failCorrelation();
  return correlated;
}

function collectLiveElementHosts(root: InkDomElement): ReadonlySet<InkDomElement> {
  const hosts = new Set<InkDomElement>();
  const stack = [...root.childNodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || node.nodeName === '#text') continue;
    if (hosts.has(node)) failCorrelation();
    hosts.add(node);
    stack.push(...node.childNodes);
  }
  return hosts;
}

function isProps(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failCorrelation(): never {
  throw new Error(INK_HOST_PROPS_CORRELATION_DIAGNOSTIC);
}
