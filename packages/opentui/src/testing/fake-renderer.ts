/**
 * A stand-in for OpenTUI's renderer, used by this package's own tests.
 *
 * It reproduces the three behaviours the adapter actually depends on, and
 * nothing else: renderables carry `screenX`/`screenY`/`num`, the renderer
 * exposes `root`, and a committed frame **writes its bytes and then emits
 * `frame`** — the ordering the real render loop has (verified against 0.5.3,
 * see NOTES.md) and the reason the adapter can mark a frame without deferring.
 *
 * It exists because `@opentui/core` cannot construct a renderer without its
 * native library, which does not load under Node (NOTES.md, "Bun-only
 * runtime"). Fidelity to the real thing is asserted separately, by
 * `opentui-types.test.ts` for the shape and by `conformance.test.ts` for the
 * behaviour.
 */

import { EventEmitter } from 'node:events';
import type { RendererLike } from '../instrument.js';
import type { RenderableLike } from '../types.js';

let counter = 0;

/** Everything a fake renderable may declare. All of it optional. */
export interface FakeRenderableOptions {
  readonly id?: string;
  readonly visible?: boolean;
  readonly screenX?: number;
  readonly screenY?: number;
  readonly width?: number;
  readonly height?: number;
  readonly focusable?: boolean;
  readonly focused?: boolean;
  readonly plainText?: string;
  readonly value?: unknown;
  readonly title?: unknown;
  readonly disabled?: unknown;
  readonly role?: unknown;
  readonly semanticName?: unknown;
  readonly testId?: unknown;
  /** Class name the role map keys on; defaults to `FakeRenderable`. */
  readonly className?: string;
  readonly children?: readonly FakeRenderable[];
}

/**
 * A renderable with OpenTUI's shape.
 *
 * `className` is honoured by overriding what `constructor.name` reports, so a
 * fake can stand in for `TextRenderable` or `InputRenderable` without this file
 * declaring a class per widget.
 */
export class FakeRenderable implements RenderableLike {
  readonly id: string;
  readonly num: number;
  visible: boolean;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
  focusable: boolean;
  focused: boolean;
  plainText?: string;
  value?: unknown;
  title?: unknown;
  disabled?: unknown;
  role?: unknown;
  semanticName?: unknown;
  testId?: unknown;
  children: FakeRenderable[];

  constructor(options: FakeRenderableOptions = {}) {
    counter += 1;
    this.num = counter;
    this.id = options.id ?? `renderable-${String(this.num)}`;
    this.visible = options.visible ?? true;
    this.screenX = options.screenX ?? 0;
    this.screenY = options.screenY ?? 0;
    this.width = options.width ?? 10;
    this.height = options.height ?? 1;
    this.focusable = options.focusable ?? false;
    this.focused = options.focused ?? false;
    this.children = [...(options.children ?? [])];
    if (options.plainText !== undefined) this.plainText = options.plainText;
    if (options.value !== undefined) this.value = options.value;
    if (options.title !== undefined) this.title = options.title;
    if (options.disabled !== undefined) this.disabled = options.disabled;
    if (options.role !== undefined) this.role = options.role;
    if (options.semanticName !== undefined) this.semanticName = options.semanticName;
    if (options.testId !== undefined) this.testId = options.testId;
    if (options.className !== undefined) {
      Object.defineProperty(this, 'constructor', {
        value: { name: options.className },
        enumerable: false,
      });
    }
  }

  getChildren(): readonly FakeRenderable[] {
    return this.children;
  }

  add(child: FakeRenderable): FakeRenderable {
    this.children.push(child);
    return child;
  }
}

/** A renderer that commits frames on demand. */
export class FakeRenderer extends EventEmitter implements RendererLike {
  readonly root: FakeRenderable;
  width: number;
  height: number;
  screenMode: string;
  /** Every chunk written to the output stream, in write order. */
  readonly written: string[] = [];
  readonly stdout: NodeJS.WriteStream;
  #frameId = 0;

  constructor(
    options: { columns?: number; rows?: number; screenMode?: string } = {},
  ) {
    super();
    this.root = new FakeRenderable({ id: 'root', width: options.columns ?? 80, height: options.rows ?? 24 });
    this.width = options.columns ?? 80;
    this.height = options.rows ?? 24;
    this.screenMode = options.screenMode ?? 'alternate-screen';
    this.stdout = makeStream(this.written);
  }

  /**
   * Commit a frame: write its bytes, then announce it — the real renderer's
   * order, and the one the marker's position depends on.
   */
  commit(frameBytes = '<frame>'): void {
    this.#frameId += 1;
    this.stdout.write(frameBytes);
    this.emit('frame', { frameId: this.#frameId });
  }

  /** Everything written so far, concatenated. */
  output(): string {
    return this.written.join('');
  }
}

function makeStream(sink: string[]): NodeJS.WriteStream {
  const stream = {
    writableEnded: false,
    destroyed: false,
    columns: 80,
    rows: 24,
    write(chunk: string | Uint8Array, callback?: () => void): boolean {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      if (text.length > 0) sink.push(text);
      // Asynchronous, like a real stream's drain callback: a marker that only
      // works because the callback fired synchronously would be a false pass.
      if (callback !== undefined) setImmediate(callback);
      return true;
    },
  };
  return stream as unknown as NodeJS.WriteStream;
}
