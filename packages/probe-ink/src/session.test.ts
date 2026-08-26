import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS, type SemanticSnapshot } from '@termwright/protocol';
import type { ProbeChannel } from '@termwright/probe-runtime';
import type { InkFrameCapture } from './frame-capture.js';
import {
  createInkMarkerWriter,
  createInkSession,
  probeInfo,
  type InkProbeSession,
  type InkSessionOptions,
} from './session.js';
import type { InkDomElement } from './observe.js';
import { trackTerminal, type InkTerminalTracker, type TerminalPosition } from './terminal-tracker.js';
import { INK_VERSION } from './instrumentation.js';
import { PACKAGE_VERSION } from './version.js';

function root(): InkDomElement {
  const label = {
    nodeName: 'ink-text' as const,
    style: {},
    childNodes: [{ nodeName: '#text' as const, nodeValue: 'Ready' }],
  };
  return { nodeName: 'ink-root', style: {}, childNodes: [label] };
}

function capture(tree: InkDomElement, overrides: Partial<InkFrameCapture['context']> = {}): InkFrameCapture {
  const geometry = new Map<InkDomElement, { intended: { row: number; column: number; width: number; height: number }; visible: { row: number; column: number; width: number; height: number }; region: 'live' }>();
  geometry.set(tree, { intended: { row: 0, column: 0, width: 20, height: 2 }, visible: { row: 0, column: 0, width: 20, height: 2 }, region: 'live' });
  geometry.set(tree.childNodes[0] as InkDomElement, { intended: { row: 0, column: 0, width: 5, height: 1 }, visible: { row: 0, column: 0, width: 5, height: 1 }, region: 'live' });
  return {
    root: tree,
    staticRoots: [],
    staticChildren: new Map(),
    rendered: { output: 'Ready\n', outputHeight: 2, staticOutput: '' },
    screenReader: false,
    geometry,
    liveRows: 2,
    staticRows: 0,
    context: {
      interactive: true,
      alternateScreen: false,
      debug: false,
      stdoutIsTTY: true,
      rows: 8,
      ...overrides,
    },
  };
}

function fakeTracker(initial: TerminalPosition = { row: 2, column: 0, buffer: 'normal' }): InkTerminalTracker & { set(value: TerminalPosition): void } {
  let position = initial;
  return {
    drain: async () => undefined,
    position: () => position,
    resize: () => undefined,
    stop: () => undefined,
    set(value) { position = value; },
  };
}

function channel(snapshots: SemanticSnapshot[], writes: string[], coalesced = { count: 0 }): ProbeChannel {
  const fake = {
    isOpen: true,
    session: { sessionId: 's1', limits: DEFAULT_LIMITS, markerEnabled: true },
    publish(snapshot: SemanticSnapshot) {
      snapshots.push(snapshot);
      return `MARK:${snapshot.revision}`;
    },
    recordCoalescedEvent() { coalesced.count += 1; },
    close() { fake.isOpen = false; },
  };
  void writes;
  return fake as unknown as ProbeChannel;
}

function stream(writes: string[]): NodeJS.WriteStream {
  const target = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperties(target, { columns: { value: 20 }, rows: { value: 8 } });
  (target as unknown as PassThrough).on('data', (chunk: Buffer) => writes.push(chunk.toString()));
  return target;
}

const flushedRender = async (): Promise<void> => undefined;

function createTestInkSession(
  options: Omit<InkSessionOptions, 'writeMarker'>,
): InkProbeSession {
  return createInkSession({
    ...options,
    writeMarker: createInkMarkerWriter(options.stdout, { certifiedHarness: true }),
  });
}

interface DelayedWriteStream extends NodeJS.WriteStream {
  flushOne(): boolean;
  pendingWrites(): number;
  waitForPendingWrites(count: number): Promise<void>;
}

function delayedStream(writes: string[]): DelayedWriteStream {
  const target = new PassThrough() as unknown as DelayedWriteStream & {
    write: (...args: unknown[]) => boolean;
  };
  const pending: Array<() => void> = [];
  const waiters: Array<{ count: number; resolve: () => void }> = [];
  Object.defineProperties(target, { columns: { value: 20 }, rows: { value: 8 } });
  target.write = ((chunk: unknown, encoding?: unknown, callback?: unknown): boolean => {
    const cb: (() => void) | undefined = typeof encoding === 'function'
      ? encoding as () => void
      : typeof callback === 'function'
        ? callback as () => void
        : undefined;
    pending.push(() => {
      writes.push(Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
        ? Buffer.from(chunk).toString()
        : String(chunk));
      cb?.();
    });
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter === undefined || pending.length < waiter.count) continue;
      waiters.splice(index, 1);
      waiter.resolve();
    }
    return true;
  }) as never;
  target.flushOne = () => {
    const next = pending.shift();
    if (next === undefined) return false;
    next();
    return true;
  };
  target.pendingWrites = () => pending.length;
  target.waitForPendingWrites = (count) => pending.length >= count
    ? Promise.resolve()
    : new Promise((resolve) => waiters.push({ count, resolve }));
  return target;
}

async function passMacrotasks(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('Ink probe session', () => {
  it('uses the ordered in-process stream on Windows without requiring a console fd', async () => {
    const writes: string[] = [];
    const output = stream(writes);
    Object.defineProperty(output, 'isTTY', { value: true });
    const nativeWrite = vi.fn();

    await createInkMarkerWriter(output, {
      certifiedHarness: true,
      platform: 'win32',
      writeWindowsMarker: nativeWrite,
    })('MARK');

    expect(writes.join('')).toBe('MARK');
    expect(nativeWrite).not.toHaveBeenCalled();
  });

  it('fails closed for a production Windows TTY without a native console fd', async () => {
    const output = stream([]);
    Object.defineProperty(output, 'isTTY', { value: true });

    await expect(createInkMarkerWriter(output, {
      certifiedHarness: false,
      platform: 'win32',
    })('MARK')).rejects.toThrow('no certifiable Windows console handle');
  });

  it('uses the native writer for a production Windows console', async () => {
    const output = stream([]);
    Object.defineProperties(output, {
      isTTY: { value: true },
      fd: { value: 17 },
    });
    const nativeWrite = vi.fn();

    await createInkMarkerWriter(output, {
      certifiedHarness: false,
      platform: 'win32',
      writeWindowsMarker: nativeWrite,
    })('MARK');

    expect(nativeWrite).toHaveBeenCalledWith(17, 'MARK');
  });

  it('keeps a production Windows non-TTY stream ordered without a console fd', async () => {
    const writes: string[] = [];
    const output = stream(writes);
    const nativeWrite = vi.fn();

    await createInkMarkerWriter(output, {
      certifiedHarness: false,
      platform: 'win32',
      writeWindowsMarker: nativeWrite,
    })('MARK');

    expect(writes.join('')).toBe('MARK');
    expect(nativeWrite).not.toHaveBeenCalled();
  });

  it('fails the semantic session when the native Windows marker write fails', async () => {
    const tree = root();
    const output = stream([]);
    Object.defineProperties(output, {
      isTTY: { value: true },
      fd: { value: 17 },
    });
    const violation = vi.fn();
    const fakeChannel = channel([], []);
    const session = createInkSession({
      channel: fakeChannel,
      resolveRoot: () => tree,
      resolveCapture: () => capture(tree),
      waitForRenderFlush: flushedRender,
      stdout: output,
      writeMarker: createInkMarkerWriter(output, {
        certifiedHarness: false,
        platform: 'win32',
        writeWindowsMarker: () => { throw new Error('native marker failed'); },
      }),
      tracker: fakeTracker(),
      onGuaranteeViolation: violation,
    });

    session.notifyRender();
    await session.flush();

    expect(violation).toHaveBeenCalledWith(expect.objectContaining({ message: 'native marker failed' }));
    expect(fakeChannel.isOpen).toBe(false);
  });

  it('advertises the exact certified geometry contract', () => {
    expect(probeInfo()).toEqual({
      framework: 'ink',
      frameworkVersion: INK_VERSION,
      probeVersion: PACKAGE_VERSION,
      identityKind: 'stable',
      capabilities: ['stable-identity', 'intended-rect', 'visible-rect', 'annotations'],
    });
  });

  it('publishes viewport geometry and writes its marker after the frame', async () => {
    const tree = root();
    const snapshots: SemanticSnapshot[] = [];
    const writes: string[] = [];
    const output = stream(writes);
    const session = createTestInkSession({
      channel: channel(snapshots, writes),
      resolveRoot: () => tree,
      resolveCapture: () => capture(tree),
      waitForRenderFlush: flushedRender,
      stdout: output,
      tracker: fakeTracker(),
    });
    session.notifyRender();
    output.write('FRAME');
    await session.flush();

    expect(writes.join('')).toBe('FRAMEMARK:1');
    expect(snapshots[0]?.nodes.find((node) => node.role === 'text')?.geometry).toMatchObject({
      intendedRect: { status: 'known', value: { row: 0, column: 0, width: 5, height: 1 } },
      visibleRect: { status: 'known', value: { row: 0, column: 0, width: 5, height: 1 } },
    });
  });

  it('waits for the forwarded frame write before appending the marker', async () => {
    const tree = root();
    const snapshots: SemanticSnapshot[] = [];
    const writes: string[] = [];
    const output = delayedStream(writes);
    const tracker = trackTerminal(output, output);
    const session = createTestInkSession({
      channel: channel(snapshots, []),
      resolveRoot: () => tree,
      resolveCapture: () => capture(tree),
      waitForRenderFlush: () => new Promise((resolve) => output.write('', () => resolve())),
      stdout: output,
      tracker,
    });
    try {
      session.notifyRender();
      output.write('FRAME');
      const flushed = session.flush();

      expect(writes).toEqual([]);
      expect(output.pendingWrites()).toBe(1);

      await output.waitForPendingWrites(2);
      expect(output.flushOne()).toBe(true);
      expect(writes).toEqual(['FRAME']);

      expect(output.flushOne()).toBe(true);
      await output.waitForPendingWrites(1);
      expect(writes).toEqual(['FRAME', '']);

      const flushStatus = await Promise.race([
        flushed.then(() => 'settled' as const),
        Promise.resolve('pending' as const),
      ]);
      expect(flushStatus).toBe('pending');

      expect(output.flushOne()).toBe(true);
      await flushed;

      expect(writes.join('')).toBe('FRAMEMARK:1');
      expect(snapshots).toHaveLength(1);
    } finally {
      session.stop();
      tracker.stop();
    }
  });

  it('waits for Ink render flush before appending the marker', async () => {
    const tree = root();
    const snapshots: SemanticSnapshot[] = [];
    const writes: string[] = [];
    const output = stream(writes);
    let releaseFlush: (() => void) | undefined;
    const renderFlush = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const session = createTestInkSession({
      channel: channel(snapshots, writes),
      resolveRoot: () => tree,
      resolveCapture: () => capture(tree),
      waitForRenderFlush: () => renderFlush,
      stdout: output,
      tracker: fakeTracker(),
    });

    session.notifyRender();
    await passMacrotasks(2);
    expect(writes).toEqual([]);
    expect(snapshots).toHaveLength(0);

    releaseFlush?.();
    await session.flush();
    expect(writes.join('')).toBe('MARK:1');
    expect(snapshots).toHaveLength(1);
  });

  it('maps Static above the live origin without disabling later geometry', async () => {
    const tree = root();
    const staticNode = { nodeName: 'ink-text' as const, style: {}, childNodes: [{ nodeName: '#text' as const, nodeValue: 'Done' }] };
    const captures = capture(tree);
    const geometry = new Map(captures.geometry);
    geometry.set(staticNode, { intended: { row: 0, column: 0, width: 4, height: 1 }, visible: { row: 0, column: 0, width: 4, height: 1 }, region: 'static' });
    (tree.childNodes as InkDomElement[]).push(staticNode);
    const withStatic: InkFrameCapture = { ...captures, geometry, staticRows: 1 };
    const snapshots: SemanticSnapshot[] = [];
    const session = createTestInkSession({
      channel: channel(snapshots, []),
      resolveRoot: () => tree,
      resolveCapture: () => withStatic,
      waitForRenderFlush: flushedRender,
      stdout: stream([]),
      tracker: fakeTracker({ row: 3, column: 0, buffer: 'normal' }),
    });
    session.notifyRender();
    await session.flush();
    const done = snapshots[0]?.nodes.find((node) => node.name === 'Done');
    const ready = snapshots[0]?.nodes.find((node) => node.name === 'Ready');
    expect(done?.geometry.intendedRect).toMatchObject({ status: 'known', value: { row: 0 } });
    expect(ready?.geometry.intendedRect).toMatchObject({ status: 'known', value: { row: 1 } });
  });

  it('fails closed on a missing capture, screen-reader frame or buffer mismatch', async () => {
    for (const mode of ['missing', 'screen-reader', 'buffer'] as const) {
      const tree = root();
      const violation = vi.fn();
      const base = capture(tree, mode === 'buffer' ? { alternateScreen: true } : {});
      const session = createTestInkSession({
        channel: channel([], []),
        resolveRoot: () => tree,
        resolveCapture: () => mode === 'missing' ? undefined : mode === 'screen-reader' ? { ...base, screenReader: true } : base,
        waitForRenderFlush: flushedRender,
        stdout: stream([]),
        tracker: fakeTracker(),
        onGuaranteeViolation: violation,
      });
      session.notifyRender();
      await session.flush();
      expect(violation).toHaveBeenCalledOnce();
    }
  });

  it('coalesces rapid rerenders and never publishes stale geometry', async () => {
    const tree = root();
    const snapshots: SemanticSnapshot[] = [];
    const coalesced = { count: 0 };
    const fakeChannel = channel(snapshots, [], coalesced);
    const session = createTestInkSession({
      channel: fakeChannel,
      resolveRoot: () => tree,
      resolveCapture: () => capture(tree),
      waitForRenderFlush: flushedRender,
      stdout: stream([]),
      tracker: fakeTracker(),
    });
    session.notifyRender();
    session.notifyRender();
    await session.flush();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.revision).toBe(1);
    expect(coalesced.count).toBe(1);
  });

  it('carries a causal publication boundary forward to a later superseding frame', async () => {
    const tree = root();
    const snapshots: SemanticSnapshot[] = [];
    const coalesced = { count: 0 };
    const session = createTestInkSession({
      channel: channel(snapshots, [], coalesced),
      resolveRoot: () => tree,
      resolveCapture: () => capture(tree),
      waitForRenderFlush: flushedRender,
      stdout: stream([]),
      tracker: fakeTracker(),
    });

    const causal = session.notifyRender({ awaitPublication: true });
    session.notifyRender();

    await expect(causal).resolves.toBe(1);
    await session.flush();
    expect(snapshots.map(({ revision }) => revision)).toEqual([1]);
    expect(coalesced.count).toBe(1);
  });

  it('rejects a causal publication boundary when the session stops', async () => {
    const tree = root();
    const session = createTestInkSession({
      channel: channel([], []),
      resolveRoot: () => tree,
      resolveCapture: () => capture(tree),
      waitForRenderFlush: flushedRender,
      stdout: stream([]),
      tracker: fakeTracker(),
    });

    const causal = session.notifyRender({ awaitPublication: true });
    session.stop();

    await expect(causal).rejects.toThrow('Ink probe stopped');
  });

  it('rejects a causal publication boundary when the semantic channel closes', async () => {
    const tree = root();
    const fakeChannel = channel([], []);
    const session = createTestInkSession({
      channel: fakeChannel,
      resolveRoot: () => tree,
      resolveCapture: () => capture(tree),
      waitForRenderFlush: flushedRender,
      stdout: stream([]),
      tracker: fakeTracker(),
    });

    const causal = session.notifyRender({ awaitPublication: true });
    fakeChannel.close();

    await expect(causal).rejects.toThrow('semantic channel closed');
  });

  it('waits when an annotation refresh sees a host tree ahead of the renderer capture', async () => {
    const tree = root();
    let currentCapture = capture(tree);
    const snapshots: SemanticSnapshot[] = [];
    const session = createTestInkSession({
      channel: channel(snapshots, []),
      resolveRoot: () => tree,
      resolveCapture: () => currentCapture,
      waitForRenderFlush: flushedRender,
      stdout: stream([]),
      tracker: fakeTracker(),
    });
    const dialog = {
      nodeName: 'ink-box' as const,
      style: {},
      childNodes: [] as InkDomElement[],
    };
    (tree.childNodes as InkDomElement[]).push(dialog);

    session.notifyRender({ allowUnsettled: true });
    await session.flush();
    expect(session.frames).toBe(0);
    expect(snapshots).toHaveLength(0);

    const geometry = new Map(currentCapture.geometry);
    geometry.set(dialog, {
      intended: { row: 1, column: 0, width: 10, height: 1 },
      visible: { row: 1, column: 0, width: 10, height: 1 },
      region: 'live',
    });
    currentCapture = { ...currentCapture, geometry };
    session.notifyRender();
    await session.flush();
    expect(session.frames).toBe(1);
    expect(snapshots).toHaveLength(1);
  });
});
