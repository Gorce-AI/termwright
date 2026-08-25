/**
 * Runtime observation of OpenTUI's render-command pass.
 *
 * It uses the renderer/root/buffer runtime and one exact-version-certified
 * private value (`renderOffset`) at the same-pass FRAME commit boundary. No
 * generated OpenTUI source or bundle is changed.
 */

import type { ObservableNode } from './observe.js';
import type { ObservableRenderer } from './session.js';
import type {
  CommittedFrameGeometry,
  FrameGeometryProvider,
  InstrumentedRect,
} from './geometry.js';

export const RUNTIME_FRAME_GEOMETRY_SYMBOL = Symbol.for(
  'termwright.opentui.runtime-frame-geometry.v1',
);

interface RuntimeBuffer {
  pushScissorRect(x: number, y: number, width: number, height: number): void;
  popScissorRect(): void;
}

interface RuntimeRenderable extends ObservableNode {
  render(buffer: RuntimeBuffer, deltaTime: number): unknown;
  readonly isDestroyed?: boolean;
}

type RuntimeCommand =
  | { readonly action: 'render'; readonly renderable: RuntimeRenderable }
  | { readonly action: 'pushScissorRect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly screenX: number; readonly screenY: number }
  | { readonly action: 'popScissorRect' | 'pushOpacity' | 'popOpacity' };

interface RuntimeRoot extends RuntimeRenderable {
  renderList: RuntimeCommand[];
  readonly currentRenderable?: RuntimeRenderable;
}

interface RuntimeRenderer extends ObservableRenderer {
  readonly root: RuntimeRoot;
  readonly frameId: number;
  readonly screenMode?: string;
  readonly renderOffset: unknown;
  requestRender(): void;
  off(event: string, handler: (event?: { readonly frameId?: number }) => void): void;
  addToHitGrid(x: number, y: number, width: number, height: number, id: number): void;
  pushHitGridScissorRect(x: number, y: number, width: number, height: number): void;
  popHitGridScissorRect(): void;
  clearHitGridScissorRects(): void;
}

interface InternalRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface PendingFrame {
  readonly frameId: number;
  readonly columns: number;
  readonly rows: number;
  readonly surfaceColumns: number;
  readonly surfaceRows: number;
  originRow: number | undefined;
  readonly intended: Map<string, InternalRect>;
  readonly visible: Map<string, InternalRect | undefined>;
  readonly clipStack: InternalRect[];
  clearCount: number;
  valid: boolean;
  complete: boolean;
  detail?: string;
}

export interface RuntimeObserver {
  readonly provider: FrameGeometryProvider;
  readonly violation: Error | undefined;
  dispose(): void;
}

type AnyMethod = (this: unknown, ...args: any[]) => any;

interface ShadowedMethod {
  readonly wrapper: AnyMethod;
  restore(): void;
}

/** Install the observer before any application-owned FRAME listener exists. */
export function installRuntimeObserver(
  input: ObservableRenderer,
  onViolation?: (error: Error) => void,
): RuntimeObserver {
  const renderer = input as unknown as RuntimeRenderer;
  assertRuntimeShape(renderer);

  let pending: PendingFrame | undefined;
  let committed: CommittedFrameGeometry | undefined;
  let fatal: Error | undefined;
  let disposed = false;
  const permanent: ShadowedMethod[] = [];
  const previousCapability = Object.getOwnPropertyDescriptor(renderer, RUNTIME_FRAME_GEOMETRY_SYMBOL);
  let frameListenerAttached = false;

  const fail = (detail: string): void => {
    if (pending !== undefined) {
      pending.valid = false;
      pending.detail ??= detail;
    }
  };
  const violate = (detail: string): void => {
    if (fatal !== undefined) return;
    fatal = new Error(detail);
    try {
      onViolation?.(fatal);
    } catch {
      // Probe diagnostics must never become an application render failure.
    }
  };

  const rootRenderShadow = () => shadowMethod(renderer.root, 'render', (originalRootRender) => function (
    buffer: RuntimeBuffer,
    deltaTime: number,
  ) {
    if (disposed || fatal !== undefined) return Reflect.apply(originalRootRender, this, [buffer, deltaTime]);
    const root = renderer.root;
    let columns: number;
    let rows: number;
    let surfaceColumns: number;
    let surfaceRows: number;
    let frameId: number;
    try {
      columns = finiteNonNegative(renderer.terminalWidth ?? renderer.width, 'terminal width');
      rows = finiteNonNegative(renderer.terminalHeight ?? renderer.height, 'terminal height');
      surfaceColumns = finiteNonNegative(renderer.width, 'surface width');
      surfaceRows = finiteNonNegative(renderer.height, 'surface height');
      frameId = finiteFrameId(renderer.frameId);
    } catch (error) {
      violate(`OpenTUI runtime observation cannot begin: ${error instanceof Error ? error.message : String(error)}`);
      return Reflect.apply(originalRootRender, this, [buffer, deltaTime]);
    }
    const current: PendingFrame = {
      frameId,
      columns,
      rows,
      surfaceColumns,
      surfaceRows,
      // Split-footer's native commit may move the surface after root.render.
      // Its certified origin is sampled by our FRAME listener below.
      originRow: renderer.screenMode === 'split-footer' ? undefined : 0,
      intended: new Map(),
      visible: new Map(),
      clipStack: [rect(0, 0, surfaceColumns, surfaceRows)],
      clearCount: 0,
      valid: true,
      complete: false,
    };
    pending = current;

    const renderShadows = new Map<RuntimeRenderable, ShadowedMethod>();
    const record = (renderable: RuntimeRenderable): void => {
      if (pending !== current || !current.valid) return;
      try {
        recordRenderable(current, renderable);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    };
    const wrapRenderable = (renderable: RuntimeRenderable): void => {
      if (renderShadows.has(renderable)) return;
      try {
        const shadow = shadowMethod(renderable, 'render', (original) => function (...args) {
          const result = Reflect.apply(original, this, args);
          if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
            fail(`OpenTUI renderable ${String(renderable.num)} returned an asynchronous render result`);
          } else {
            record(renderable);
          }
          return result;
        });
        renderShadows.set(renderable, shadow);
      } catch (error) {
        fail(`cannot observe OpenTUI render command ${String(renderable.num)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const inspectCommand = (candidate: unknown): void => {
      if (candidate === null || typeof candidate !== 'object') {
        fail('OpenTUI render list contains a non-object command');
        return;
      }
      const command = candidate as Partial<RuntimeCommand>;
      if (command.action === 'render') {
        if (command.renderable === undefined || typeof command.renderable.render !== 'function') {
          fail('OpenTUI render command has no renderable method');
        } else {
          wrapRenderable(command.renderable);
        }
        return;
      }
      if (command.action === 'pushScissorRect') {
        return;
      }
      if (!['pushScissorRect', 'popScissorRect', 'pushOpacity', 'popOpacity'].includes(String(command.action))) {
        fail(`OpenTUI render list contains unknown action ${String(command.action)}`);
      }
    };

    let renderList: RuntimeCommand[];
    let renderListDescriptor: PropertyDescriptor;
    try {
      renderList = root.renderList;
      const descriptor = Object.getOwnPropertyDescriptor(root, 'renderList');
      if (descriptor === undefined || !('value' in descriptor) || descriptor.value !== renderList) {
        throw new Error('renderList is not an own data property');
      }
      renderListDescriptor = descriptor;
    } catch (error) {
      violate(`OpenTUI root.renderList cannot be read: ${error instanceof Error ? error.message : String(error)}`);
      return Reflect.apply(originalRootRender, this, [buffer, deltaTime]);
    }
    if (!Array.isArray(renderList)) {
      violate('OpenTUI root.renderList is not an array');
      return Reflect.apply(originalRootRender, this, [buffer, deltaTime]);
    }
    for (const command of renderList) inspectCommand(command);
    const proxy = new Proxy(renderList, {
      set(target, property, value, receiver) {
        if (property !== 'length') inspectCommand(value);
        return Reflect.set(target, property, value, receiver);
      },
      defineProperty(target, property, descriptor) {
        if (property !== 'length' && 'value' in descriptor) inspectCommand(descriptor.value);
        return Reflect.defineProperty(target, property, descriptor);
      },
    });

    let bufferPush: ShadowedMethod | undefined;
    let bufferPop: ShadowedMethod | undefined;
    let originalStarted = false;
    let setupFailed = false;
    let result: unknown;
    try {
      Object.defineProperty(root, 'renderList', { ...renderListDescriptor, value: proxy });
      bufferPush = shadowMethod(buffer, 'pushScissorRect', (original) => function (
        x: number, y: number, width: number, height: number,
      ) {
        if (pending === current && root.currentRenderable === undefined) {
          try {
            current.clipStack.push(intersection(
              current.clipStack.at(-1)!,
              rect(x, y, width, height),
            ));
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error));
          }
        }
        return Reflect.apply(original, this, [x, y, width, height]);
      });
      bufferPop = shadowMethod(buffer, 'popScissorRect', (original) => function (...args) {
        if (pending === current && root.currentRenderable === undefined) {
          if (current.clipStack.length <= 1) fail('OpenTUI output scissor stack underflow');
          else current.clipStack.pop();
        }
        return Reflect.apply(original, this, args);
      });

      originalStarted = true;
      result = Reflect.apply(originalRootRender, this, [buffer, deltaTime]);
      if (root.renderList !== proxy) fail('OpenTUI replaced root.renderList during the observed render pass');
      if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
        fail('OpenTUI root.render returned an asynchronous result');
      }
      if (root.visible !== false) completeTree(current, root);
      const expectedClears = root.visible === false ? 0 : 1;
      if (current.clearCount !== expectedClears) {
        fail(`OpenTUI render pass cleared hit-grid scissors ${current.clearCount} times; expected ${expectedClears}`);
      }
      if (current.clipStack.length !== 1) fail('OpenTUI output scissor stack is unbalanced');
      current.complete = true;
    } catch (error) {
      current.valid = false;
      if (originalStarted) {
        current.detail ??= `OpenTUI root render failed: ${error instanceof Error ? error.message : String(error)}`;
        throw error;
      }
      current.detail ??= `OpenTUI runtime observation setup failed: ${error instanceof Error ? error.message : String(error)}`;
      setupFailed = true;
    } finally {
      const cleanupFailures: string[] = [];
      const restore = (label: string, action: () => void): void => {
        try { action(); } catch (error) {
          cleanupFailures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      const installedBufferPop = bufferPop;
      const installedBufferPush = bufferPush;
      if (installedBufferPop !== undefined) restore('buffer.popScissorRect', () => installedBufferPop.restore());
      if (installedBufferPush !== undefined) restore('buffer.pushScissorRect', () => installedBufferPush.restore());
      for (const shadow of [...renderShadows.values()].reverse()) {
        restore('renderable.render', () => shadow.restore());
      }
      restore('root.renderList', () => {
        const currentRenderList = Object.getOwnPropertyDescriptor(root, 'renderList');
        if (currentRenderList !== undefined && 'value' in currentRenderList && currentRenderList.value === proxy) {
          Object.defineProperty(root, 'renderList', renderListDescriptor);
        }
      });
      if (cleanupFailures.length > 0) {
        current.valid = false;
        current.detail ??= `OpenTUI runtime observation cleanup failed: ${cleanupFailures.join('; ')}`;
        violate(current.detail);
      }
    }
    if (setupFailed) {
      violate(current.detail ?? 'OpenTUI runtime observation setup failed');
      return Reflect.apply(originalRootRender, this, [buffer, deltaTime]);
    }
    return result;
  });

  const frameListener = (event?: { readonly frameId?: number }): void => {
    if (disposed || fatal !== undefined) return;
    try {
      const frameId = event?.frameId ?? renderer.frameId;
      if (pending === undefined || pending.frameId !== frameId || !pending.complete || !pending.valid) {
        const detail = pending?.detail ?? `OpenTUI frame ${String(frameId)} has no complete runtime observation`;
        pending = undefined;
        violate(detail);
        return;
      }
      const originRow = renderer.screenMode === 'split-footer'
        ? finiteNonNegative(renderer.renderOffset, 'renderOffset')
        : 0;
      pending.originRow = originRow;
      if (originRow === undefined) {
        violate('OpenTUI split-footer render pass has no certified surface-origin evidence');
        pending = undefined;
        return;
      }
      const intended = new Map<string, InstrumentedRect>();
      const visible = new Map<string, InstrumentedRect>();
      for (const [key, value] of pending.intended) intended.set(key, publicRect(value, originRow));
      for (const [key, value] of pending.visible) {
        visible.set(key, value === undefined
          ? culledRect(pending.intended.get(key)!, originRow, pending.columns, pending.rows)
          : publicRect(value, originRow));
      }
      committed = Object.freeze({
        frameId: pending.frameId,
        columns: pending.columns,
        rows: pending.rows,
        surfaceColumns: pending.surfaceColumns,
        surfaceRows: pending.surfaceRows,
        surfaceOrigin: Object.freeze({ row: originRow, column: 0 }),
        intended,
        visible,
      });
      pending = undefined;
    } catch (error) {
      violate(`OpenTUI runtime commit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const provider: FrameGeometryProvider = Object.freeze({
    version: 1,
    frameworkVersion: 'runtime-observer',
    getCommitted(frameId: number) {
      return committed?.frameId === frameId ? committed : undefined;
    },
  });
  try {
    permanent.push(shadowMethod(renderer, 'clearHitGridScissorRects', (original) => function (...args) {
      if (pending !== undefined) pending.clearCount += 1;
      return Reflect.apply(original, this, args);
    }));
    permanent.push(rootRenderShadow());
    renderer.on('frame', frameListener);
    frameListenerAttached = true;
    Object.defineProperty(renderer, RUNTIME_FRAME_GEOMETRY_SYMBOL, {
      configurable: true,
      enumerable: false,
      value: provider,
    });
  } catch (error) {
    if (frameListenerAttached) {
      try { renderer.off('frame', frameListener); } catch { /* continue rollback */ }
    }
    restoreShadows(permanent);
    try { restoreCapability(renderer, provider, previousCapability); } catch { /* continue rollback */ }
    throw error;
  }

  return {
    provider,
    get violation() { return fatal; },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { renderer.off('frame', frameListener); } catch { /* teardown must not break the application */ }
      restoreShadows(permanent);
      try { restoreCapability(renderer, provider, previousCapability); } catch { /* best-effort after hostile mutation */ }
    },
  };
}

export function runtimeGeometryProvider(renderer: object): FrameGeometryProvider | undefined {
  const value = (renderer as Record<PropertyKey, unknown>)[RUNTIME_FRAME_GEOMETRY_SYMBOL];
  if (value === null || typeof value !== 'object') return undefined;
  const provider = value as Partial<FrameGeometryProvider>;
  return provider.version === 1 && typeof provider.getCommitted === 'function'
    ? provider as FrameGeometryProvider
    : undefined;
}

function assertRuntimeShape(renderer: RuntimeRenderer): void {
  if (renderer === null || typeof renderer !== 'object') throw new Error('OpenTUI renderer is unavailable');
  if (renderer.root === null || typeof renderer.root !== 'object') throw new Error('OpenTUI renderer.root is unavailable');
  if (typeof renderer.root.render !== 'function') throw new Error('OpenTUI root.render is unavailable');
  if (!Array.isArray(renderer.root.renderList)) throw new Error('OpenTUI root.renderList is unavailable');
  for (const key of ['on', 'off', 'requestRender', 'addToHitGrid', 'pushHitGridScissorRect', 'popHitGridScissorRect', 'clearHitGridScissorRects', 'hitTest']) {
    if (typeof (renderer as unknown as Record<string, unknown>)[key] !== 'function') {
      throw new Error(`OpenTUI renderer.${key} is unavailable`);
    }
  }
  assertShadowable(renderer, 'clearHitGridScissorRects');
  assertShadowable(renderer.root, 'render');
  const renderListDescriptor = Object.getOwnPropertyDescriptor(renderer.root, 'renderList');
  if (renderListDescriptor === undefined || !('value' in renderListDescriptor) || !Array.isArray(renderListDescriptor.value)) {
    throw new Error('OpenTUI root.renderList must be an own array data property');
  }
  if (renderListDescriptor.configurable !== true && renderListDescriptor.writable !== true) {
    throw new Error('OpenTUI root.renderList cannot be observed');
  }
  if (!Object.isExtensible(renderer)
    && !Object.hasOwn(renderer, RUNTIME_FRAME_GEOMETRY_SYMBOL)) {
    throw new Error('OpenTUI renderer cannot expose runtime geometry capability');
  }
  const runtimeCapability = Object.getOwnPropertyDescriptor(renderer, RUNTIME_FRAME_GEOMETRY_SYMBOL);
  if (runtimeCapability !== undefined && runtimeCapability.configurable !== true) {
    throw new Error('OpenTUI runtime geometry capability cannot be replaced');
  }
  finiteFrameId(renderer.frameId);
  finiteNonNegative(renderer.renderOffset, 'renderOffset');
}

function restoreCapability(
  renderer: RuntimeRenderer,
  provider: FrameGeometryProvider,
  previous: PropertyDescriptor | undefined,
): void {
  const current = Object.getOwnPropertyDescriptor(renderer, RUNTIME_FRAME_GEOMETRY_SYMBOL);
  if (current?.value !== provider) return;
  if (previous === undefined) delete (renderer as unknown as Record<PropertyKey, unknown>)[RUNTIME_FRAME_GEOMETRY_SYMBOL];
  else Object.defineProperty(renderer, RUNTIME_FRAME_GEOMETRY_SYMBOL, previous);
}

function restoreShadows(shadows: ShadowedMethod[]): void {
  for (const shadow of [...shadows].reverse()) {
    try { shadow.restore(); } catch { /* keep restoring the remaining descriptors */ }
  }
}

function assertShadowable(target: object, key: string): void {
  const own = Object.getOwnPropertyDescriptor(target, key);
  if (own !== undefined && own.configurable !== true && own.writable !== true) {
    throw new Error(`${key} cannot be wrapped`);
  }
  if (!Object.isExtensible(target) && own === undefined) {
    throw new Error(`${key} cannot be shadowed on a non-extensible object`);
  }
}

function shadowMethod<T extends object>(
  target: T,
  key: string,
  build: (original: AnyMethod) => AnyMethod,
): ShadowedMethod {
  const own = Object.getOwnPropertyDescriptor(target, key);
  const original = (target as Record<string, unknown>)[key];
  if (typeof original !== 'function') throw new Error(`${key} is not callable`);
  assertShadowable(target, key);
  const wrapper = build(original as AnyMethod);
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: own?.enumerable ?? false,
    writable: true,
    value: wrapper,
  });
  return {
    wrapper,
    restore() {
      if ((target as Record<string, unknown>)[key] !== wrapper) return;
      if (own === undefined) delete (target as Record<string, unknown>)[key];
      else Object.defineProperty(target, key, own);
    },
  };
}

function recordRenderable(frame: PendingFrame, renderable: RuntimeRenderable): void {
  const key = identityOf(renderable);
  const intended = rect(renderable.screenX, renderable.screenY, renderable.width, renderable.height);
  const visible = intersection(intended, frame.clipStack.at(-1)!);
  frame.intended.set(key, intended);
  frame.visible.set(key, visible);
}

function completeTree(frame: PendingFrame, root: RuntimeRenderable): void {
  recordRenderable(frame, root);
  const visit = (node: ObservableNode, displayed: boolean): void => {
    const shown = displayed && node.visible !== false;
    const key = identityOf(node);
    if (shown && !frame.visible.has(key)) {
      const intended = rect(node.screenX, node.screenY, node.width, node.height);
      frame.intended.set(key, intended);
      frame.visible.set(key, undefined);
    }
    for (const child of node.getChildren?.() ?? []) visit(child, shown);
  };
  visit(root, true);
}

function identityOf(node: Pick<ObservableNode, 'num'>): string {
  if (!Number.isSafeInteger(node.num) || node.num <= 0) throw new Error(`invalid OpenTUI renderable identity ${String(node.num)}`);
  return String(node.num);
}

function rect(x: unknown, y: unknown, width: unknown, height: unknown): InternalRect {
  const left = finite(x, 'x');
  const top = finite(y, 'y');
  return {
    left,
    top,
    right: left + Math.max(0, finite(width, 'width')),
    bottom: top + Math.max(0, finite(height, 'height')),
  };
}

function intersection(left: InternalRect, right: InternalRect): InternalRect {
  const x = Math.max(left.left, right.left);
  const y = Math.max(left.top, right.top);
  return {
    left: x,
    top: y,
    right: Math.max(x, Math.min(left.right, right.right)),
    bottom: Math.max(y, Math.min(left.bottom, right.bottom)),
  };
}

function publicRect(value: InternalRect, originRow: number): InstrumentedRect {
  return Object.freeze({
    row: value.top + originRow,
    column: value.left,
    width: value.right - value.left,
    height: value.bottom - value.top,
  });
}

function culledRect(
  intended: InternalRect,
  originRow: number,
  columns: number,
  rows: number,
): InstrumentedRect {
  return Object.freeze({
    row: Math.min(Math.max(intended.top + originRow, 0), rows),
    column: Math.min(Math.max(intended.left, 0), columns),
    width: 0,
    height: 0,
  });
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`OpenTUI ${label} is not finite`);
  return value;
}

function finiteNonNegative(value: unknown, label: string): number {
  return Math.max(0, finite(value, label));
}

function finiteFrameId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`OpenTUI frameId ${String(value)} is invalid`);
  }
  return value;
}
