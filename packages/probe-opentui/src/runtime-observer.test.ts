import { describe, expect, it, vi } from 'vitest';
import { installRuntimeObserver } from './runtime-observer.js';
import type { ObservableNode } from './observe.js';
import type { ObservableRenderer } from './session.js';

interface FakeBuffer {
  pushScissorRect(x: number, y: number, width: number, height: number): void;
  popScissorRect(): void;
}

interface FakeRenderable extends ObservableNode {
  render(buffer: FakeBuffer, deltaTime: number): void;
  isDestroyed?: boolean;
}

type FakeCommand =
  | { action: 'render'; renderable: FakeRenderable }
  | {
      action: 'pushScissorRect';
      x: number;
      y: number;
      width: number;
      height: number;
      screenX: number;
      screenY: number;
    }
  | { action: 'popScissorRect' };

function node(name: string, num: number, extra: Partial<FakeRenderable> = {}): FakeRenderable {
  const value = {
    num,
    screenX: 0,
    screenY: 0,
    width: 10,
    height: 1,
    visible: true,
    getChildren: () => [],
    render: () => undefined,
    ...extra,
  };
  return Object.setPrototypeOf(value, { constructor: { name } }) as FakeRenderable;
}

function fakeRuntime(children: FakeRenderable[], commands: FakeCommand[]) {
  const handlers: Array<(event: { frameId: number }) => void> = [];
  const buffer: FakeBuffer = {
    pushScissorRect: () => undefined,
    popScissorRect: () => undefined,
  };
  const root = node('RootRenderable', 1, {
    width: 80,
    height: 24,
    getChildren: () => children,
  }) as FakeRenderable & {
    renderList: FakeCommand[];
    currentRenderable: FakeRenderable | undefined;
  };
  root.currentRenderable = undefined;
  root.renderList = [{ action: 'render', renderable: root }, ...commands];
  const renderer = {
    root,
    width: 80,
    height: 24,
    terminalWidth: 80,
    terminalHeight: 24,
    frameId: 0,
    renderOffset: 0,
    hitTest: () => 0,
    requestRender: () => undefined,
    addToHitGrid: () => undefined,
    pushHitGridScissorRect: (_x: number, _y: number, _width: number, _height: number) => undefined,
    popHitGridScissorRect: () => undefined,
    clearHitGridScissorRects: () => undefined,
    on: (_event: string, handler: (event: { frameId: number }) => void) => handlers.push(handler),
    off: (_event: string, handler: (event: { frameId: number }) => void) => {
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
  };
  root.render = function (_buffer, deltaTime) {
    renderer.clearHitGridScissorRects();
    for (let index = 1; index < root.renderList.length; index += 1) {
      const command = root.renderList[index]!;
      if (command.action === 'render') {
        if (command.renderable.isDestroyed) continue;
        root.currentRenderable = command.renderable;
        command.renderable.render(buffer, deltaTime);
        root.currentRenderable = undefined;
      } else if (command.action === 'pushScissorRect') {
        buffer.pushScissorRect(command.x, command.y, command.width, command.height);
        renderer.pushHitGridScissorRect(
          command.screenX,
          command.screenY,
          command.width,
          command.height,
        );
      } else {
        buffer.popScissorRect();
        renderer.popHitGridScissorRect();
      }
    }
  };
  let nativeCommit = (): void => undefined;
  return {
    renderer: renderer as unknown as ObservableRenderer & { frameId: number },
    root,
    buffer,
    listenerCount: () => handlers.length,
    setNativeCommit(commit: () => void) {
      nativeCommit = commit;
    },
    render() {
      renderer.frameId += 1;
      root.render(buffer, 16);
      nativeCommit();
      for (const handler of [...handlers]) handler({ frameId: renderer.frameId });
    },
  };
}

describe('OpenTUI runtime observer', () => {
  it('records a custom render override even when it never touches the hit grid', () => {
    const custom = node('CustomRenderable', 2, { screenX: 4, screenY: 3, width: 12, height: 2 });
    const runtime = fakeRuntime([custom], [{ action: 'render', renderable: custom }]);
    const observer = installRuntimeObserver(runtime.renderer);

    runtime.render();

    expect(observer.provider.getCommitted(1)?.intended.get('2')).toEqual({
      row: 3,
      column: 4,
      width: 12,
      height: 2,
    });
    expect(observer.provider.getCommitted(1)?.visible.get('2')).toEqual({
      row: 3,
      column: 4,
      width: 12,
      height: 2,
    });
    expect(observer.violation).toBeUndefined();
  });

  it('samples geometry after render hooks and before a later sibling mutates it', () => {
    const first = node('CustomRenderable', 2, { screenX: 1 });
    first.render = () => {
      (first as { screenX?: number }).screenX = 5;
    };
    const second = node('CustomRenderable', 3);
    second.render = () => {
      (first as { screenX?: number }).screenX = 20;
    };
    const runtime = fakeRuntime(
      [first, second],
      [
        { action: 'render', renderable: first },
        { action: 'render', renderable: second },
      ],
    );
    const observer = installRuntimeObserver(runtime.renderer);

    runtime.render();

    expect(observer.provider.getCommitted(1)?.intended.get('2')?.column).toBe(5);
  });

  it('uses output-buffer coordinates for nested clipping', () => {
    const child = node('CustomRenderable', 2, { screenX: 5, screenY: 2, width: 10, height: 4 });
    const runtime = fakeRuntime(
      [child],
      [
        { action: 'pushScissorRect', x: 2, y: 1, screenX: 22, screenY: 11, width: 6, height: 3 },
        { action: 'pushScissorRect', x: 4, y: 2, screenX: 24, screenY: 12, width: 3, height: 2 },
        { action: 'render', renderable: child },
        { action: 'popScissorRect' },
        { action: 'popScissorRect' },
      ],
    );
    const observer = installRuntimeObserver(runtime.renderer);

    runtime.render();

    expect(observer.provider.getCommitted(1)?.visible.get('2')).toEqual({
      row: 2,
      column: 5,
      width: 2,
      height: 2,
    });
  });

  it('wraps commands added while the root rebuilds its render list', () => {
    const dynamic = node('DynamicRenderable', 2, { screenX: 7 });
    const runtime = fakeRuntime([dynamic], []);
    const original = runtime.root.render;
    runtime.root.render = function (buffer, deltaTime) {
      runtime.root.renderList.push({ action: 'render', renderable: dynamic });
      return original.call(this, buffer, deltaTime);
    };
    const observer = installRuntimeObserver(runtime.renderer);

    runtime.render();

    expect(observer.provider.getCommitted(1)?.intended.get('2')?.column).toBe(7);
  });

  it('gives a culled displayed child zero visible area', () => {
    const culled = node('TextRenderable', 2, { screenX: 90, screenY: 2, width: 5, height: 1 });
    const runtime = fakeRuntime([culled], []);
    const observer = installRuntimeObserver(runtime.renderer);

    runtime.render();

    expect(observer.provider.getCommitted(1)?.intended.get('2')).toEqual({
      row: 2,
      column: 90,
      width: 5,
      height: 1,
    });
    expect(observer.provider.getCommitted(1)?.visible.get('2')).toEqual({
      row: 2,
      column: 80,
      width: 0,
      height: 0,
    });
  });

  it('samples certified split-footer origin after the native commit for the same render pass', () => {
    const child = node('TextRenderable', 2, { screenY: 2 });
    const runtime = fakeRuntime([child], [{ action: 'render', renderable: child }]);
    (runtime.renderer as unknown as { screenMode: string }).screenMode = 'split-footer';
    (runtime.renderer as unknown as { renderOffset: number }).renderOffset = 2;
    runtime.setNativeCommit(() => {
      (runtime.renderer as unknown as { renderOffset: number }).renderOffset = 7;
    });
    const observer = installRuntimeObserver(runtime.renderer);

    runtime.render();

    expect(observer.provider.getCommitted(1)?.surfaceOrigin).toEqual({ row: 7, column: 0 });
    expect(observer.provider.getCommitted(1)?.intended.get('2')?.row).toBe(9);
  });

  it('contains hostile descriptor cleanup and reports a typed violation', () => {
    const custom = node('HostileRenderable', 2);
    custom.render = function () {
      Object.defineProperty(custom, 'render', {
        configurable: false,
        writable: false,
        value: custom.render,
      });
    };
    const runtime = fakeRuntime([custom], [{ action: 'render', renderable: custom }]);
    const violation = vi.fn();
    const observer = installRuntimeObserver(runtime.renderer, violation);

    expect(() => runtime.render()).not.toThrow();
    expect(observer.provider.getCommitted(1)).toBeUndefined();
    expect(violation).toHaveBeenCalledOnce();
    expect(observer.violation?.message).toMatch(/cleanup failed.*renderable\.render/u);
  });

  it('fails closed when split-footer loses its certified surface origin', () => {
    const runtime = fakeRuntime([], []);
    (runtime.renderer as unknown as { screenMode: string }).screenMode = 'split-footer';
    const observer = installRuntimeObserver(runtime.renderer);
    (runtime.renderer as unknown as { renderOffset: unknown }).renderOffset = undefined;

    expect(() => runtime.render()).not.toThrow();
    expect(observer.provider.getCommitted(1)).toBeUndefined();
    expect(observer.violation?.message).toMatch(/renderOffset/u);
  });

  it('matches the empty geometry pass of an invisible root', () => {
    const runtime = fakeRuntime([], []);
    (runtime.root as { visible?: boolean }).visible = false;
    runtime.root.render = () => undefined;
    const observer = installRuntimeObserver(runtime.renderer);

    runtime.render();

    expect(observer.provider.getCommitted(1)?.intended.size).toBe(0);
    expect(observer.provider.getCommitted(1)?.visible.size).toBe(0);
    expect(observer.violation).toBeUndefined();
  });

  it('never commits a partial pass and reports an unknown command fail-closed', () => {
    const runtime = fakeRuntime([], []);
    runtime.root.renderList.push({ action: 'future-action' } as never);
    const violation = vi.fn();
    const observer = installRuntimeObserver(runtime.renderer, violation);

    expect(() => runtime.render()).not.toThrow();
    expect(observer.provider.getCommitted(1)).toBeUndefined();
    expect(violation).toHaveBeenCalledOnce();
    expect(observer.violation?.message).toMatch(/unknown action/u);
  });

  it('does not break application rendering when runtime dimensions become invalid', () => {
    const custom = node('CustomRenderable', 2);
    custom.render = vi.fn();
    const runtime = fakeRuntime([custom], [{ action: 'render', renderable: custom }]);
    const violation = vi.fn(() => {
      throw new Error('diagnostic consumer failed');
    });
    const observer = installRuntimeObserver(runtime.renderer, violation);
    (runtime.renderer as unknown as { width: number }).width = Number.NaN;

    expect(() => runtime.render()).not.toThrow();
    expect(custom.render).toHaveBeenCalledOnce();
    expect(observer.provider.getCommitted(1)).toBeUndefined();
    expect(observer.violation?.message).toMatch(/surface width/u);
  });

  it('rejects missing wrapping capabilities before changing renderer methods', () => {
    const runtime = fakeRuntime([], []);
    const renderer = runtime.renderer as unknown as {
      clearHitGridScissorRects(): void;
    };
    const clear = renderer.clearHitGridScissorRects;
    Object.defineProperty(renderer, 'clearHitGridScissorRects', {
      configurable: false,
      writable: false,
      value: clear,
    });

    expect(() => installRuntimeObserver(runtime.renderer)).toThrow(/cannot be wrapped/u);
    expect(renderer.clearHitGridScissorRects).toBe(clear);
  });

  it('restores application-owned methods on dispose', () => {
    const custom = node('CustomRenderable', 2);
    const runtime = fakeRuntime([custom], [{ action: 'render', renderable: custom }]);
    const rootRender = runtime.root.render;
    const clear = (runtime.renderer as unknown as { clearHitGridScissorRects(): void })
      .clearHitGridScissorRects;
    const observer = installRuntimeObserver(runtime.renderer);

    observer.dispose();

    expect(runtime.root.render).toBe(rootRender);
    expect(
      (runtime.renderer as unknown as { clearHitGridScissorRects(): void })
        .clearHitGridScissorRects,
    ).toBe(clear);
    expect(runtime.listenerCount()).toBe(0);
  });

  it('restores an existing runtime capability descriptor exactly', () => {
    const runtime = fakeRuntime([], []);
    const symbol = Symbol.for('termwright.opentui.runtime-frame-geometry.v1');
    const previous = Object.freeze({ owner: 'application' });
    Object.defineProperty(runtime.renderer, symbol, {
      configurable: true,
      enumerable: true,
      writable: false,
      value: previous,
    });
    const before = Object.getOwnPropertyDescriptor(runtime.renderer, symbol);

    const observer = installRuntimeObserver(runtime.renderer);
    observer.dispose();

    expect(Object.getOwnPropertyDescriptor(runtime.renderer, symbol)).toEqual(before);
    expect((runtime.renderer as unknown as Record<PropertyKey, unknown>)[symbol]).toBe(previous);
  });

  it('restores the exact renderList descriptor after every observed pass', () => {
    const runtime = fakeRuntime([], []);
    Object.defineProperty(runtime.root, 'renderList', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: runtime.root.renderList,
    });
    const before = Object.getOwnPropertyDescriptor(runtime.root, 'renderList');
    const observer = installRuntimeObserver(runtime.renderer);

    runtime.render();
    observer.dispose();

    expect(Object.getOwnPropertyDescriptor(runtime.root, 'renderList')).toEqual(before);
  });

  it('fails closed when the framework replaces renderList during a pass', () => {
    const runtime = fakeRuntime([], []);
    const original = runtime.root.render;
    runtime.root.render = function (buffer, deltaTime) {
      const result = original.call(this, buffer, deltaTime);
      runtime.root.renderList = [];
      return result;
    };
    const observer = installRuntimeObserver(runtime.renderer);

    runtime.render();

    expect(observer.provider.getCommitted(1)).toBeUndefined();
    expect(observer.violation?.message).toMatch(/replaced root\.renderList/u);
  });

  it('fails closed without requestRender before changing the renderer', () => {
    const runtime = fakeRuntime([], []);
    const rootRender = runtime.root.render;
    delete (runtime.renderer as unknown as { requestRender?: () => void }).requestRender;

    expect(() => installRuntimeObserver(runtime.renderer)).toThrow(/requestRender/u);
    expect(runtime.root.render).toBe(rootRender);
    expect(runtime.listenerCount()).toBe(0);
  });

  it('calls the original render safely when renderList changes shape', () => {
    const child = node('CustomRenderable', 2);
    child.render = vi.fn();
    const runtime = fakeRuntime([child], [{ action: 'render', renderable: child }]);
    runtime.root.render = () => child.render(runtime.buffer, 16);
    const observer = installRuntimeObserver(runtime.renderer);
    (runtime.root as unknown as { renderList: unknown }).renderList = null;

    expect(() => runtime.render()).not.toThrow();
    expect(child.render).toHaveBeenCalledOnce();
    expect(observer.violation?.message).toMatch(/renderList is not an array/u);
  });
});
