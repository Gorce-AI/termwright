/** Ink's retained host tree to framework-neutral Probe IR. */

import type {
  ProbeAccessibilityHints,
  ProbeFrame,
  ProbeObject,
  ProbeObservedState,
  ProbeRect,
  ProbeUnobservableField,
  ProtocolLimits,
} from '@termwright/protocol';
import { annotationForInkNode } from './annotations.js';
import type { RelativeGeometry } from './frame-capture.js';

/** Structural subset of Ink's DOM node. No runtime import from `ink`. */
export interface InkDomElement {
  readonly nodeName: 'ink-root' | 'ink-box' | 'ink-text' | 'ink-virtual-text';
  readonly childNodes: readonly InkDomNode[];
  readonly parentNode?: InkDomElement;
  readonly style?: Readonly<Record<string, unknown>> & { readonly display?: string };
  readonly internal_static?: boolean;
  readonly staticNode?: InkDomElement;
  readonly internal_accessibility?: {
    readonly role?: string;
    readonly state?: {
      readonly checked?: boolean;
      readonly disabled?: boolean;
      readonly expanded?: boolean;
      readonly readonly?: boolean;
      readonly selected?: boolean;
      readonly busy?: boolean;
      readonly multiline?: boolean;
      readonly required?: boolean;
      readonly multiselectable?: boolean;
    };
  };
}

export interface InkTextNode {
  readonly nodeName: '#text';
  readonly nodeValue: string;
  readonly parentNode?: InkDomElement;
}

export type InkDomNode = InkDomElement | InkTextNode;

/** Public Ink measurement function, kept injectable for tests and isolation. */
export type MeasureElement = (node: InkDomElement) => {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export interface ObserveInkOptions {
  readonly frame: number;
  readonly limits: ProtocolLimits;
  /** The probe's own hidden Box. It is the sole injected node and is omitted. */
  readonly excluded?: InkDomElement | null;
  /** Renderer-retained roots (notably committed <Static>) detached by Ink later. */
  readonly retainedRoots?: readonly InkDomElement[];
  readonly retainedChildren?: ReadonlyMap<InkDomElement, readonly InkDomNode[]>;
  readonly measureElement?: MeasureElement;
  /** Geometry frozen by the certified 7.1.1 renderer instrumentation. */
  readonly geometry?: ReadonlyMap<InkDomElement, RelativeGeometry>;
}

export interface InkObservation {
  readonly frame: ProbeFrame;
  readonly truncated: boolean;
  readonly geometryRegions: ReadonlyMap<string, 'live' | 'static'>;
}

const isElement = (node: InkDomNode): node is InkDomElement => node.nodeName !== '#text';

/**
 * Observe every Ink host element, including plain unannotated layout boxes.
 *
 * Source component names do not survive Ink's reconciler. `frameworkType` is
 * therefore deliberately one of Ink's four host kinds; inventing `Button` or
 * a component stack here would be false provenance.
 */
export function observeInkTree(root: InkDomElement, options: ObserveInkOptions): InkObservation {
  const objects: ProbeObject[] = [];
  const ids = identityStore(root);
  let truncated = false;
  const geometryRegions = new Map<string, 'live' | 'static'>();
  const visited = new Set<InkDomElement>();

  const visit = (
    node: InkDomElement,
    parent: InkDomElement | undefined,
    depth: number,
    ancestorHidden: boolean,
  ): void => {
    if (node === options.excluded || visited.has(node)) return;
    visited.add(node);
    if (depth > options.limits.maxDepth || objects.length >= options.limits.maxNodes) {
      truncated = true;
      return;
    }

    const hidden = ancestorHidden || node.style?.display === 'none';
    const state = observedState(node, !hidden);
    const annotations = annotationForInkNode(
      node,
      (target) => ids.idFor(target as InkDomElement),
      options.limits,
    );
    const accessibility = observedAccessibility(node);
    const geometry = geometryOf(node, options);
    const identity = ids.idFor(node);
    const region = options.geometry?.get(node)?.region;
    if (region !== undefined) geometryRegions.set(identity, region);
    // Probe IR's `text` is the object's own text, never a descendant-derived
    // accessible name. The recognizer applies name-from-content over the tree.
    const children = options.retainedChildren?.get(node) ?? node.childNodes;
    const text = isTextHost(node) ? textOf(children, options.limits.maxStringBytes) : undefined;
    const unobservable = unobservableFor(
      node,
      geometry?.intendedRect !== undefined,
      text !== undefined,
    );

    objects.push({
      identity: { kind: 'stable', value: identity },
      frameworkType: node.nodeName,
      ...(parent === undefined ? {} : { parent: ids.idFor(parent) }),
      ...(geometry === undefined ? {} : { geometry }),
      ...(state === undefined ? {} : { state }),
      ...(text === undefined ? {} : { text }),
      ...(accessibility === undefined ? {} : { accessibility }),
      ...(annotations === undefined ? {} : { annotations }),
      unobservable,
    });

    for (const child of children) {
      // Raw `#text` values are payload owned by their `ink-text` host, not a
      // fifth host kind. The text is retained on that host above.
      if (isElement(child)) visit(child, node, depth + 1, hidden);
    }
  };

  visit(root, undefined, 0, false);
  // Ink removes committed <Static> children from the live root but retains the
  // exact host subtree in root.staticNode for the separately rendered static
  // output. Observe that retained subtree as a root child when it is no longer
  // reachable through childNodes; the identity and captured layout stay exact.
  if (root.staticNode !== undefined) visit(root.staticNode, root, 1, false);
  for (const retained of options.retainedRoots ?? []) visit(retained, root, 1, false);
  return { frame: { frame: options.frame, objects }, truncated, geometryRegions };
}

/** Weak identity is stable for exactly the lifetime of Ink's host object. */
const stores = new WeakMap<InkDomElement, IdentityStore>();

interface IdentityStore {
  idFor(node: InkDomElement): string;
}

function identityStore(root: InkDomElement): IdentityStore {
  let store = stores.get(root);
  if (store !== undefined) return store;
  const ids = new WeakMap<InkDomElement, string>();
  let nextId = 0;
  store = {
    idFor(node) {
      const existing = ids.get(node);
      if (existing !== undefined) return existing;
      nextId += 1;
      const id = String(nextId);
      ids.set(node, id);
      return id;
    },
  };
  stores.set(root, store);
  return store;
}

function isTextHost(node: InkDomElement): boolean {
  return node.nodeName === 'ink-text' || node.nodeName === 'ink-virtual-text';
}

function observedAccessibility(node: InkDomElement): ProbeAccessibilityHints | undefined {
  const role = node.internal_accessibility?.role;
  return role === undefined ? undefined : { role };
}

function observedState(node: InkDomElement, displayed: boolean): ProbeObservedState | undefined {
  const accessibility = node.internal_accessibility?.state;
  const state: ProbeObservedState = {
    displayed,
    ...(accessibility?.checked === undefined ? {} : { checked: accessibility.checked }),
    ...(accessibility?.disabled === undefined ? {} : { disabled: accessibility.disabled }),
    ...(accessibility?.expanded === undefined ? {} : { expanded: accessibility.expanded }),
    ...(accessibility?.readonly === undefined ? {} : { readonly: accessibility.readonly }),
    ...(accessibility?.selected === undefined ? {} : { selected: accessibility.selected }),
    ...(accessibility?.busy === undefined ? {} : { busy: accessibility.busy }),
    ...(accessibility?.multiline === undefined ? {} : { multiline: accessibility.multiline }),
    ...(accessibility?.required === undefined ? {} : { required: accessibility.required }),
    ...(accessibility?.multiselectable === undefined
      ? {}
      : { multiselectable: accessibility.multiselectable }),
  };
  return state;
}

function geometryOf(
  node: InkDomElement,
  options: ObserveInkOptions,
): { readonly intendedRect: ProbeRect; readonly visibleRect: ProbeRect } | undefined {
  const geometry = options.geometry?.get(node);
  return geometry === undefined
    ? undefined
    : { intendedRect: geometry.intended, visibleRect: geometry.visible };
}

function textOf(children: readonly InkDomNode[], maxBytes: number): string | undefined {
  const parts: string[] = [];
  let bytes = 0;

  const append = (value: string): void => {
    for (const codePoint of value) {
      const size = Buffer.byteLength(codePoint, 'utf8');
      if (bytes + size > maxBytes) return;
      parts.push(codePoint);
      bytes += size;
    }
  };

  // Raw #text children are this host's payload. Nested host elements retain
  // their own ProbeObjects, so folding them in here would violate the IR's
  // own-text contract and duplicate them during name-from-content inference.
  for (const child of children) {
    if (bytes >= maxBytes) break;
    if (!isElement(child)) append(child.nodeValue);
  }
  const text = parts.join('').replace(/\s+/gu, ' ').trim();
  return text.length === 0 ? undefined : text;
}

function unobservableFor(
  node: InkDomElement,
  hasGeometry: boolean,
  hasText: boolean,
): readonly ProbeUnobservableField[] {
  const result: ProbeUnobservableField[] = [
    'focused',
    'value',
    'selectedIndex',
    'textSelection',
    'scroll',
    'scrollExtent',
    'paintOrder',
  ];
  const state = node.internal_accessibility?.state;
  if (state?.disabled === undefined) result.push('disabled');
  if (state?.checked === undefined) result.push('checked');
  if (state?.expanded === undefined) result.push('expanded');
  if (state?.readonly === undefined) result.push('readonly');
  if (state?.selected === undefined) result.push('selected');
  if (state?.busy === undefined) result.push('busy');
  if (state?.multiline === undefined) result.push('multiline');
  if (!hasGeometry) result.push('intendedRect', 'visibleRect');
  if (!hasText && isTextHost(node)) result.push('text');
  return result;
}
