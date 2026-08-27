/** Frame-local Ink layout facts captured at the exact renderer boundary. */

import type { ProbeRect } from '@termwright/protocol';
import {
  INK_RENDER_CAPTURE,
  INK_FRAME_CONTEXT,
  type InkRenderCaptureHook,
  type InkRenderedOutput,
} from './instrumentation.js';
import type { InkDomElement, InkDomNode } from './observe.js';

interface YogaNodeLike {
  getDisplay(): number;
  getComputedLeft(): number;
  getComputedTop(): number;
  getComputedWidth(): number;
  getComputedHeight(): number;
  getComputedBorder(edge: number): number;
}

interface RenderableInkElement extends InkDomElement {
  readonly yogaNode?: YogaNodeLike;
  readonly style?: InkDomElement['style'] & {
    readonly overflow?: string;
    readonly overflowX?: string;
    readonly overflowY?: string;
  };
}

export interface RelativeGeometry {
  readonly intended: ProbeRect;
  readonly visible: ProbeRect;
  readonly region: 'live' | 'static';
}

export interface InkFrameCapture {
  readonly root: InkDomElement;
  /** Static host subtrees retained at the renderer boundary, before Ink detaches them. */
  readonly staticRoots: readonly InkDomElement[];
  /** Immutable child lists for static hosts that Ink mutates after output commit. */
  readonly staticChildren: ReadonlyMap<InkDomElement, readonly InkDomNode[]>;
  readonly rendered: InkRenderedOutput;
  readonly screenReader: boolean;
  readonly geometry: ReadonlyMap<InkDomElement, RelativeGeometry>;
  readonly liveRows: number;
  readonly staticRows: number;
  readonly context?: InkFrameContext;
}

export interface InkFrameContext {
  readonly interactive: boolean;
  readonly alternateScreen: boolean;
  readonly debug: boolean;
  readonly stdoutIsTTY: boolean;
  readonly rows: number;
}

const latest = new WeakMap<object, InkFrameCapture>();

/** Install one process-wide receiver used by every certified Ink renderer. */
export function installInkCaptureHook(): () => void {
  const globals = globalThis as Record<PropertyKey, unknown>;
  const previous = globals[INK_RENDER_CAPTURE];
  const previousContext = globals[INK_FRAME_CONTEXT];
  const hook: InkRenderCaptureHook = (root, rendered, screenReader) => {
    if (screenReader) {
      retainInkFrame({
        root: root as InkDomElement,
        staticRoots:
          (root as InkDomElement).staticNode === undefined
            ? []
            : [(root as InkDomElement).staticNode as InkDomElement],
        staticChildren: snapshotStaticChildren((root as InkDomElement).staticNode),
        rendered,
        screenReader,
        geometry: new Map(),
        liveRows: visibleRows(rendered.output),
        staticRows: visibleRows(rendered.staticOutput),
      });
      return;
    }
    retainInkFrame(captureInkLayout(root as InkDomElement, rendered));
  };
  globals[INK_RENDER_CAPTURE] = hook;
  const contextHook = (root: object, context: InkFrameContext): void => {
    const frame = latest.get(root);
    if (frame !== undefined) latest.set(root, { ...frame, context });
  };
  globals[INK_FRAME_CONTEXT] = contextHook;
  return () => {
    if (globals[INK_RENDER_CAPTURE] === hook) {
      if (previous === undefined) delete globals[INK_RENDER_CAPTURE];
      else globals[INK_RENDER_CAPTURE] = previous;
    }
    if (globals[INK_FRAME_CONTEXT] === contextHook) {
      if (previousContext === undefined) delete globals[INK_FRAME_CONTEXT];
      else globals[INK_FRAME_CONTEXT] = previousContext;
    }
  };
}

/** Exact traversal used by the checksummed hook and the pinned in-process harness. */
export function captureInkLayout(
  root: InkDomElement,
  rendered: InkRenderedOutput,
  context?: InkFrameContext,
): InkFrameCapture {
  const inkRoot = root as RenderableInkElement;
  const geometry = new Map<InkDomElement, RelativeGeometry>();
  const width = integer(inkRoot.yogaNode?.getComputedWidth());
  const height = integer(inkRoot.yogaNode?.getComputedHeight());
  walk(inkRoot, 'live', 0, 0, rect(0, 0, width, height), geometry, true);
  if (inkRoot.staticNode !== undefined) {
    const staticRoot = inkRoot.staticNode as RenderableInkElement;
    walk(
      staticRoot,
      'static',
      0,
      0,
      rect(
        0,
        0,
        integer(staticRoot.yogaNode?.getComputedWidth()),
        integer(staticRoot.yogaNode?.getComputedHeight()),
      ),
      geometry,
      false,
    );
  }
  return {
    root: inkRoot,
    staticRoots: inkRoot.staticNode === undefined ? [] : [inkRoot.staticNode],
    staticChildren: snapshotStaticChildren(inkRoot.staticNode),
    rendered,
    screenReader: false,
    geometry,
    liveRows: visibleRows(rendered.output),
    staticRows: visibleRows(rendered.staticOutput),
    ...(context === undefined ? {} : { context }),
  };
}

export function capturedInkFrame(root: object): InkFrameCapture | undefined {
  return latest.get(root);
}

export function retainInkFrame(capture: InkFrameCapture): void {
  const previous = latest.get(capture.root);
  if (previous === undefined || capture.screenReader) {
    latest.set(capture.root, capture);
    return;
  }
  const previousRoots = new Set(previous.staticRoots);
  const addedRoots = capture.staticRoots.filter((root) => !previousRoots.has(root));
  const newStaticNodes = new Set(
    [...capture.staticChildren.keys()].filter((node) => !previous.staticChildren.has(node)),
  );
  const hasNewStaticOutput = capture.staticRows > 0 && newStaticNodes.size > 0;
  if (!hasNewStaticOutput) {
    const retainedGeometry = new Map(capture.geometry);
    for (const [node, geometry] of previous.geometry) {
      if (geometry.region === 'static') retainedGeometry.set(node, geometry);
    }
    latest.set(capture.root, {
      ...capture,
      staticRoots: previous.staticRoots,
      staticChildren: previous.staticChildren,
      staticRows: previous.staticRows,
      geometry: retainedGeometry,
    });
    return;
  }

  const geometry = new Map(capture.geometry);
  for (const [node, retained] of previous.geometry) {
    if (retained.region === 'static') geometry.set(node, retained);
  }
  for (const [node, current] of capture.geometry) {
    if (current.region === 'static') {
      if (newStaticNodes.has(node)) {
        geometry.set(node, {
          ...current,
          intended: shiftRows(current.intended, previous.staticRows),
          visible: shiftRows(current.visible, previous.staticRows),
        });
      } else if (capture.staticRoots.includes(node)) {
        const retained = previous.geometry.get(node);
        if (retained !== undefined) {
          geometry.set(node, {
            ...retained,
            intended: { ...retained.intended, height: previous.staticRows + capture.staticRows },
            visible: { ...retained.visible, height: previous.staticRows + capture.staticRows },
          });
        }
      }
    }
  }
  const staticChildren = new Map(previous.staticChildren);
  for (const [parent, currentChildren] of capture.staticChildren) {
    const retained = staticChildren.get(parent) ?? [];
    staticChildren.set(parent, [
      ...retained,
      ...currentChildren.filter((child) => !retained.includes(child)),
    ]);
  }
  latest.set(capture.root, {
    ...capture,
    staticRoots: [...previous.staticRoots, ...addedRoots],
    staticChildren,
    staticRows: previous.staticRows + capture.staticRows,
    geometry,
  });
}

function snapshotStaticChildren(
  root: InkDomElement | undefined,
): ReadonlyMap<InkDomElement, readonly InkDomNode[]> {
  const result = new Map<InkDomElement, readonly InkDomNode[]>();
  if (root === undefined) return result;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop() as InkDomElement;
    const children = [...node.childNodes];
    result.set(node, children);
    for (const child of children) if (child.nodeName !== '#text') stack.push(child);
  }
  return result;
}

function shiftRows(value: ProbeRect, rows: number): ProbeRect {
  return { ...value, row: value.row + rows };
}

function walk(
  node: RenderableInkElement,
  region: 'live' | 'static',
  offsetX: number,
  offsetY: number,
  ancestorClip: ProbeRect,
  output: Map<InkDomElement, RelativeGeometry>,
  skipStatic: boolean,
): void {
  if (skipStatic && node.internal_static === true) return;
  const yoga = node.yogaNode;
  // Yoga.DISPLAY_NONE is 1 in the pinned 7.1.1 yoga build. Hidden subtrees are
  // represented by displayed=false in the tree and deliberately have no box.
  if (yoga === undefined || yoga.getDisplay() === 1) return;

  const x = offsetX + integer(yoga.getComputedLeft());
  const y = offsetY + integer(yoga.getComputedTop());
  const intended = rect(x, y, integer(yoga.getComputedWidth()), integer(yoga.getComputedHeight()));
  const visible = intersection(intended, ancestorClip);
  output.set(node, { intended, visible, region });

  let childClip = ancestorClip;
  if (node.nodeName === 'ink-box') {
    const horizontal = node.style?.overflowX === 'hidden' || node.style?.overflow === 'hidden';
    const vertical = node.style?.overflowY === 'hidden' || node.style?.overflow === 'hidden';
    if (horizontal || vertical) {
      const left = horizontal ? x + integer(yoga.getComputedBorder(0)) : ancestorClip.column;
      const right = horizontal
        ? x + intended.width - integer(yoga.getComputedBorder(2))
        : ancestorClip.column + ancestorClip.width;
      const top = vertical ? y + integer(yoga.getComputedBorder(1)) : ancestorClip.row;
      const bottom = vertical
        ? y + intended.height - integer(yoga.getComputedBorder(3))
        : ancestorClip.row + ancestorClip.height;
      childClip = intersection(ancestorClip, rect(left, top, right - left, bottom - top));
    }
  }

  for (const child of node.childNodes) {
    if (child.nodeName !== '#text') {
      walk(child as RenderableInkElement, region, x, y, childClip, output, skipStatic);
    }
  }
}

function integer(value: number | undefined): number {
  return Number.isFinite(value) ? Math.trunc(value as number) : 0;
}

function rect(column: number, row: number, width: number, height: number): ProbeRect {
  return {
    row,
    column,
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

function intersection(a: ProbeRect, b: ProbeRect): ProbeRect {
  const column = Math.max(a.column, b.column);
  const row = Math.max(a.row, b.row);
  const right = Math.max(column, Math.min(a.column + a.width, b.column + b.width));
  const bottom = Math.max(row, Math.min(a.row + a.height, b.row + b.height));
  return rect(column, row, right - column, bottom - row);
}

function visibleRows(output: string): number {
  if (output === '') return 0;
  const lines = output.split('\n');
  return output.endsWith('\n') ? lines.length - 1 : lines.length;
}
