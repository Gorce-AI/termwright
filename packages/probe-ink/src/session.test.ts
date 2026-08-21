import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS, type SemanticSnapshot } from '@termwright/protocol';
import type { ProbeChannel } from '@termwright/probe-runtime';
import { createInkSession, probeInfo } from './session.js';
import type { InkDomElement } from './observe.js';
import { PACKAGE_VERSION } from './version.js';

function root(): InkDomElement {
  const label = {
    nodeName: 'ink-text' as const,
    style: {},
    childNodes: [{ nodeName: '#text' as const, nodeValue: 'Ready' }],
  };
  return { nodeName: 'ink-root', style: {}, childNodes: [label] };
}

function channel(
  events: string[],
  snapshots: SemanticSnapshot[] = [],
  coalesced?: { count: number },
): ProbeChannel {
  const fake = {
    isOpen: true,
    session: { sessionId: 's1', limits: DEFAULT_LIMITS, markerEnabled: true },
    publish(snapshot: SemanticSnapshot) {
      snapshots.push(snapshot);
      events.push(`snapshot:${snapshot.revision}`);
      return `MARK:${snapshot.revision}`;
    },
    recordCoalescedEvent() {
      if (coalesced !== undefined) coalesced.count += 1;
    },
    close() {
      fake.isOpen = false;
    },
  };
  return fake as unknown as ProbeChannel;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitForDrain(drains: readonly (() => void)[]): Promise<void> {
  for (let turn = 0; turn < 5 && drains.length === 0; turn += 1) await nextTurn();
}

describe('Ink probe session', () => {
  it('describes stable host identity and the optional annotation channel', () => {
    expect(probeInfo()).toEqual({
      framework: 'ink',
      probeVersion: PACKAGE_VERSION,
      identityKind: 'stable',
      capabilities: ['stable-identity', 'annotations'],
    });
  });

  it('writes the marker only after queued frame bytes drain', async () => {
    const stream = new PassThrough() as unknown as NodeJS.WriteStream;
    let output = '';
    (stream as unknown as PassThrough).on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const events: string[] = [];
    const session = createInkSession({
      channel: channel(events),
      resolveRoot: root,
      measureElement: () => ({ x: 0, y: 0, width: 1, height: 1 }),
      stdout: stream,
      includeGeometry: false,
    });

    session.notifyRender();
    // Ink writes only after onRender (and therefore notifyRender) returns.
    stream.write('FRAME');
    await session.flush();

    expect(events).toEqual(['snapshot:1']);
    expect(output).toBe('FRAMEMARK:1');
  });

  it('freezes the tree synchronously, before a later mutation', () => {
    const text = { nodeName: '#text' as const, nodeValue: 'Before' };
    const label = { nodeName: 'ink-text' as const, style: {}, childNodes: [text] };
    const liveRoot = { nodeName: 'ink-root' as const, style: {}, childNodes: [label] };
    const events: string[] = [];
    const snapshots: SemanticSnapshot[] = [];
    const stream = new PassThrough() as unknown as NodeJS.WriteStream;
    stream.resume();
    const session = createInkSession({
      channel: channel(events, snapshots),
      resolveRoot: () => liveRoot,
      measureElement: () => ({ x: 0, y: 0, width: 1, height: 1 }),
      stdout: stream,
      includeGeometry: false,
    });

    session.notifyRender();
    text.nodeValue = 'After';

    expect(snapshots[0]?.nodes.find((node) => node.role === 'text')?.name).toBe('Before');
  });

  it('publishes frozen snapshots but marks only the latest superseding commit', async () => {
    const stream = new PassThrough() as unknown as NodeJS.WriteStream;
    let output = '';
    (stream as unknown as PassThrough).on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const events: string[] = [];
    const coalesced = { count: 0 };
    const session = createInkSession({
      channel: channel(events, [], coalesced),
      resolveRoot: root,
      measureElement: () => ({ x: 0, y: 0, width: 1, height: 1 }),
      stdout: stream,
      includeGeometry: false,
    });

    session.notifyRender();
    session.notifyRender();
    await session.flush();

    expect(events).toEqual(['snapshot:1', 'snapshot:2']);
    expect(output).toBe('MARK:2');
    expect(session.frames).toBe(2);
    expect(session.revision).toBe(2);
    expect(coalesced.count).toBe(1);
  });

  it('drops an old marker when a newer frame arrives during drain', async () => {
    const writes: string[] = [];
    const drains: (() => void)[] = [];
    const stream = {
      columns: 80,
      rows: 24,
      writableEnded: false,
      destroyed: false,
      write(chunk: string, encodingOrCallback?: unknown, callback?: () => void) {
        const done = typeof encodingOrCallback === 'function'
          ? encodingOrCallback as () => void
          : callback;
        if (chunk === '' && done !== undefined) drains.push(done);
        else {
          writes.push(chunk);
          done?.();
        }
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const events: string[] = [];
    const coalesced = { count: 0 };
    const session = createInkSession({
      channel: channel(events, [], coalesced),
      resolveRoot: root,
      measureElement: () => ({ x: 0, y: 0, width: 1, height: 1 }),
      stdout: stream,
      includeGeometry: false,
    });

    session.notifyRender();
    stream.write('FRAME1');
    await waitForDrain(drains);
    expect(drains).toHaveLength(1);

    session.notifyRender();
    stream.write('FRAME2');
    drains.shift()?.();
    await waitForDrain(drains);
    expect(drains).toHaveLength(1);
    drains.shift()?.();
    await session.flush();

    expect(events).toEqual(['snapshot:1', 'snapshot:2']);
    expect(writes).toEqual(['FRAME1', 'FRAME2', 'MARK:2']);
    expect(coalesced.count).toBe(1);
  });

  it('keeps geometry disabled after Static content has shifted the live region', () => {
    const staticRoot = root() as InkDomElement & { internal_static?: boolean };
    staticRoot.internal_static = true;
    const snapshots: SemanticSnapshot[] = [];
    const stream = new PassThrough() as unknown as NodeJS.WriteStream;
    stream.resume();
    const session = createInkSession({
      channel: channel([], snapshots),
      resolveRoot: () => staticRoot,
      measureElement: () => ({ x: 4, y: 3, width: 8, height: 1 }),
      stdout: stream,
      includeGeometry: true,
    });

    session.notifyRender();
    staticRoot.internal_static = false;
    session.notifyRender();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.nodes.every((node) => node.bounds === undefined)).toBe(true);
    expect(snapshots[1]?.nodes.every((node) => node.bounds === undefined)).toBe(true);
  });

  it('contains observer faults instead of throwing into the application', () => {
    const events: string[] = [];
    const fakeChannel = channel(events);
    const close = vi.spyOn(fakeChannel, 'close');
    const broken = {
      nodeName: 'ink-root' as const,
      style: {},
      get childNodes(): readonly never[] {
        throw new Error('upstream internals changed');
      },
    };
    const stream = new PassThrough() as unknown as NodeJS.WriteStream;
    stream.resume();
    const session = createInkSession({
      channel: fakeChannel,
      resolveRoot: () => broken,
      measureElement: () => ({ x: 0, y: 0, width: 1, height: 1 }),
      stdout: stream,
      includeGeometry: false,
    });

    expect(() => session.notifyRender()).not.toThrow();
    expect(close).toHaveBeenCalledOnce();
    expect(events).toHaveLength(0);
  });
});
