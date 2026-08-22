/**
 * The publication cycle, without a driver and without a terminal.
 *
 * Publication is injected, so the whole order — tree, then commit, then marker
 * after the frame's bytes — can be asserted against a recording double. That
 * order is the contract; under OpenTUI it is only knowable at all because the
 * sink puts the frame bytes in JS first.
 */

import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS, validateSnapshot, type SemanticSnapshot } from '@termwright/protocol';
import { createMarkerSink } from './sink.js';
import { probeInfo, startSession, type ObservableRenderer } from './session.js';
import type { ObservableNode } from './observe.js';
import {
  FRAME_GEOMETRY_SYMBOL,
  OPENTUI_VERSION,
  type CommittedFrameGeometry,
} from './instrumentation.js';

function renderable(name: string, num: number, extra: Partial<ObservableNode> = {}): ObservableNode {
  const base = {
    num,
    screenX: 0,
    screenY: 0,
    width: 10,
    height: 1,
    visible: true,
    getChildren: () => [],
    ...extra,
  };
  return Object.setPrototypeOf(base, { constructor: { name } }) as ObservableNode;
}

/** A renderer whose frame event the test drives by hand. */
function fakeRenderer(root: ObservableNode): ObservableRenderer & {
  emit(geometry?: Partial<CommittedFrameGeometry>): void;
} {
  const handlers: ((event: { frameId: number }) => void)[] = [];
  let frameId = 0;
  let committed: CommittedFrameGeometry | undefined;
  const renderer: ObservableRenderer & { emit(geometry?: Partial<CommittedFrameGeometry>): void } = {
    root,
    width: 80,
    height: 24,
    terminalWidth: 80,
    terminalHeight: 24,
    get frameId() { return frameId; },
    hitTest: () => root.num,
    on: (_event, handler) => handlers.push(handler),
    emit: (overrides = {}) => {
      frameId += 1;
      const intended = new Map<string, { row: number; column: number; width: number; height: number }>();
      const visible = new Map<string, { row: number; column: number; width: number; height: number }>();
      const visit = (node: ObservableNode, ancestorsDisplayed: boolean): void => {
        const displayed = ancestorsDisplayed && node.visible !== false;
        if (displayed) {
          const rect = { row: node.screenY ?? 0, column: node.screenX ?? 0, width: node.width ?? 0, height: node.height ?? 0 };
          intended.set(String(node.num), rect);
          visible.set(String(node.num), { ...rect });
        }
        for (const child of node._childrenInZIndexOrder ?? node.getChildren?.() ?? []) visit(child, displayed);
      };
      try {
        visit(root, true);
      } catch {
        // The provider is independent of the retained-tree observation. The
        // session itself must contain a broken application getter.
      }
      committed = {
        frameId,
        columns: 80,
        rows: 24,
        surfaceColumns: 80,
        surfaceRows: 24,
        surfaceOrigin: { row: 0, column: 0 },
        intended,
        visible,
        ...overrides,
      };
      for (const handler of [...handlers]) handler({ frameId });
    },
  };
  Object.defineProperty(renderer, FRAME_GEOMETRY_SYMBOL, {
    value: {
      version: 1,
      frameworkVersion: OPENTUI_VERSION,
      getCommitted: (requested: number) => committed?.frameId === requested ? committed : undefined,
    },
  });
  return renderer;
}

/** Captures what the session published, and what it was told to write back. */
function recorder(marker: (revision: number) => string | undefined = (r) => `MARK:${r}`) {
  const snapshots: SemanticSnapshot[] = [];
  return {
    snapshots,
    publisher: {
      publish(snapshot: SemanticSnapshot): string | undefined {
        snapshots.push(snapshot);
        return marker(snapshot.revision);
      },
    },
  };
}

describe('what the probe says about itself', () => {
  it('claims stable identity, because num is a readonly counter', () => {
    const info = probeInfo('0.5.3');

    expect(info.framework).toBe('opentui');
    expect(info.identityKind).toBe('stable');
    expect(info.frameworkVersion).toBe('0.5.3');
  });

  it('claims paint-order, which is what makes occlusion answerable', () => {
    expect(probeInfo().capabilities).toContain('paint-order');
  });

  it('claims annotations because every observation reads the optional weak channel', () => {
    expect(probeInfo().capabilities).toContain('annotations');
  });

  it('does not claim frame-begin, which OpenTUI cannot promise', () => {
    // Its callback sits inside loop(), so there is no hook guaranteed to fire
    // before every frame. Claiming it would make a consumer wait for something
    // that never comes.
    expect(probeInfo().capabilities).not.toContain('frame-begin');
  });
});

describe('the publication cycle', () => {
  it('publishes a tree per frame, with strictly increasing revisions', () => {
    const renderer = fakeRenderer(renderable('RootRenderable', 1));
    const { publisher, snapshots } = recorder();
    const session = startSession({ renderer, publisher, sessionId: 's1' });

    renderer.emit();
    renderer.emit();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]!.revision).toBeGreaterThan(snapshots[0]!.revision);
    expect(session.revision).toBe(2);
  });

  /** Everything goes through one queue now, so the assertion has to let it drain. */
  const drained = async (sink: { write(chunk: string, cb: () => void): unknown }): Promise<void> =>
    new Promise((resolve) => sink.write('', () => resolve()));

  it('writes the marker after the frame bytes, never before', async () => {
    const target = new PassThrough();
    const order: string[] = [];
    target.on('data', (chunk: Buffer) => order.push(chunk.toString('utf8')));

    const sink = createMarkerSink(target as unknown as NodeJS.WriteStream);
    const root = renderable('RootRenderable', 1);
    const renderer = fakeRenderer(root);
    const { publisher } = recorder();
    startSession({ renderer, publisher, sink, sessionId: 's1' });

    // A frame's bytes reach the sink first; the session appends afterwards.
    sink.write('FRAME-1');
    renderer.emit();
    sink.write('FRAME-2');
    renderer.emit();
    await drained(sink);

    // The marker must never overtake the frame it commits. Writing straight to
    // the target instead of through the sink did exactly that, and this is the
    // assertion that caught it.
    expect(order).toEqual(['FRAME-1', 'MARK:1', 'FRAME-2', 'MARK:2']);
  });

  it('forwards frame bytes verbatim, adding nothing but the marker', async () => {
    const target = new PassThrough();
    let seen = '';
    target.on('data', (chunk: Buffer) => {
      seen += chunk.toString('utf8');
    });

    const sink = createMarkerSink(target as unknown as NodeJS.WriteStream);
    sink.write('[2J[Hhello');
    await drained(sink);

    expect(seen).toBe('[2J[Hhello');
    expect(sink.forwarded).toBe('[2J[Hhello'.length);
  });

  it('skips the marker when the publisher does not ask for one', async () => {
    const target = new PassThrough();
    const order: string[] = [];
    target.on('data', (chunk: Buffer) => order.push(chunk.toString('utf8')));

    const sink = createMarkerSink(target as unknown as NodeJS.WriteStream);
    const renderer = fakeRenderer(renderable('RootRenderable', 1));
    const { publisher } = recorder(() => undefined);
    startSession({ renderer, publisher, sink, sessionId: 's1' });

    renderer.emit();
    await drained(sink);

    expect(order).toEqual([]);
  });
});

describe('the application survives the probe', () => {
  it('keeps running when observation throws', () => {
    const exploding = Object.setPrototypeOf(
      {
        num: 1,
        getChildren: () => {
          throw new Error('framework moved a getter');
        },
      },
      { constructor: { name: 'RootRenderable' } },
    ) as ObservableNode;

    const renderer = fakeRenderer(exploding);
    const { publisher, snapshots } = recorder();
    const session = startSession({ renderer, publisher, sessionId: 's1' });

    expect(() => renderer.emit()).not.toThrow();
    expect(snapshots).toHaveLength(0);
    // The frame was seen even though nothing was published: revisions are
    // strictly increasing, not contiguous, so a lost frame is legal.
    expect(session.frames).toBe(1);
  });

  it('keeps running when publishing throws', () => {
    const renderer = fakeRenderer(renderable('RootRenderable', 1));
    const publisher = {
      publish: vi.fn(() => {
        throw new Error('socket gone');
      }),
    };
    startSession({ renderer, publisher, sessionId: 's1' });

    expect(() => renderer.emit()).not.toThrow();
    expect(publisher.publish).toHaveBeenCalledOnce();
  });

  it('stops publishing once stopped', () => {
    const renderer = fakeRenderer(renderable('RootRenderable', 1));
    const { publisher, snapshots } = recorder();
    const session = startSession({ renderer, publisher, sessionId: 's1' });

    renderer.emit();
    session.stop();
    renderer.emit();

    expect(snapshots).toHaveLength(1);
  });
});

describe('what reaches the driver', () => {
  it('publishes v2 intended geometry and an exact compressed hit grid', () => {
    const child = renderable('InputRenderable', 2, { screenX: 2, screenY: 1, width: 4, height: 1 });
    const root = renderable('RootRenderable', 1, { _childrenInZIndexOrder: [child] });
    const renderer = fakeRenderer(root);
    renderer.hitTest = (x, y) => y === 1 && x >= 2 && x < 6 ? 2 : 1;
    const { publisher, snapshots } = recorder((r) => `MARK:${r}`);
    startSession({ renderer, publisher, sessionId: 's1' });
    renderer.emit();

    const snapshot = snapshots[0]!;
    expect(snapshot.v).toBe(2);
    expect(snapshot.nodes[1]?.geometry?.intendedRect).toMatchObject({ status: 'known', value: { row: 1, column: 2, width: 4, height: 1 } });
    expect(snapshot.nodes[1]?.geometry?.visibleRect).toMatchObject({ status: 'known', value: { row: 1, column: 2, width: 4, height: 1 } });
    expect(snapshot.hitGrid).toMatchObject({ status: 'known' });
    const validation = validateSnapshot(snapshot, DEFAULT_LIMITS);
    if (!validation.ok) throw new Error(validation.detail);
  });

  it('is a snapshot the protocol accepts', () => {
    const root = renderable('RootRenderable', 1, {
      _childrenInZIndexOrder: [
        renderable('InputRenderable', 2, { value: 'draft', focused: true }),
        renderable('TextRenderable', 3, { chunks: [{ text: 'Approve' }] }),
      ],
    });
    const renderer = fakeRenderer(root);
    const { publisher, snapshots } = recorder();
    startSession({ renderer, publisher, sessionId: 's1' });

    renderer.emit();

    const snapshot = snapshots[0] as SemanticSnapshot;
    const validation = validateSnapshot(snapshot, DEFAULT_LIMITS);
    if (!validation.ok) throw new Error(validation.detail);
    expect(snapshot.nodes.map((node) => node.role)).toEqual(['application', 'textbox', 'text']);
    expect(snapshot.nodes[1]?.value).toEqual({
      status: 'known',
      value: 'draft',
      sensitivity: 'sensitive',
      evidence: {
        source: 'framework', method: 'instrumented', strength: 'authoritative', providerId: 'opentui',
      },
    });
  });
});

describe('authoritative geometry and hit-grid guarantees', () => {
  it('keeps nested clipping independent from topmost pointer ownership', () => {
    const lower = renderable('BoxRenderable', 2, { screenX: 2, screenY: 2, width: 8, height: 5 });
    const upper = renderable('BoxRenderable', 3, { screenX: 4, screenY: 3, width: 8, height: 5 });
    const root = renderable('RootRenderable', 1, { _childrenInZIndexOrder: [lower, upper] });
    const renderer = fakeRenderer(root);
    renderer.hitTest = (x, y) => x >= 4 && x < 8 && y >= 3 && y < 6 ? 3 : x >= 2 && x < 8 && y >= 2 && y < 6 ? 2 : 1;
    const { publisher, snapshots } = recorder();
    startSession({ renderer, publisher, sessionId: 's1' });

    const intended = new Map([
      ['1', { row: 0, column: 0, width: 80, height: 24 }],
      ['2', { row: 2, column: 2, width: 8, height: 5 }],
      ['3', { row: 3, column: 4, width: 8, height: 5 }],
    ]);
    const visible = new Map([
      ['1', { row: 0, column: 0, width: 80, height: 24 }],
      ['2', { row: 2, column: 2, width: 6, height: 4 }],
      ['3', { row: 3, column: 4, width: 4, height: 3 }],
    ]);
    renderer.emit({ intended, visible });

    expect(snapshots[0]?.nodes[1]?.geometry.visibleRect).toMatchObject({ status: 'known', value: visible.get('2') });
    expect(snapshots[0]?.nodes[2]?.geometry.visibleRect).toMatchObject({ status: 'known', value: visible.get('3') });
    expect(snapshots[0]?.hitGrid).toMatchObject({ status: 'known' });
    const regions = snapshots[0]?.hitGrid.status === 'known' ? snapshots[0].hitGrid.value.regions : [];
    expect(regions.some((region) => region.recipientId === 'n3')).toBe(true);
    expect(regions.some((region) => region.recipientId === 'n2')).toBe(true);
  });

  it('publishes hidden descendants as not displayed rather than stale geometry', () => {
    const child = renderable('TextRenderable', 2, { visible: false });
    const root = renderable('RootRenderable', 1, { _childrenInZIndexOrder: [child] });
    const renderer = fakeRenderer(root);
    const { publisher, snapshots } = recorder();
    startSession({ renderer, publisher, sessionId: 's1' });
    renderer.emit();
    expect(snapshots[0]?.nodes[1]?.geometry).toMatchObject({
      displayed: { status: 'known', value: false },
      visibleRect: { status: 'absent', reason: 'not-displayed' },
    });
  });

  it('uses the committed resize and surface origin atomically', () => {
    const root = renderable('RootRenderable', 1);
    const renderer = fakeRenderer(root);
    const hitTest = vi.fn(() => 1);
    renderer.hitTest = hitTest;
    const { publisher, snapshots } = recorder();
    startSession({ renderer, publisher, sessionId: 's1' });
    renderer.emit({
      columns: 20,
      rows: 10,
      surfaceColumns: 20,
      surfaceRows: 4,
      surfaceOrigin: { row: 6, column: 0 },
      intended: new Map([['1', { row: 6, column: 0, width: 20, height: 4 }]]),
      visible: new Map([['1', { row: 6, column: 0, width: 20, height: 4 }]]),
    });
    expect(snapshots[0]).toMatchObject({ columns: 20, rows: 10 });
    expect(hitTest).toHaveBeenCalledWith(0, 0);
    expect(hitTest).not.toHaveBeenCalledWith(0, 6);
  });

  it('fails closed without publishing when a successful event lacks its committed frame', () => {
    const renderer = fakeRenderer(renderable('RootRenderable', 1));
    const provider = (renderer as unknown as Record<PropertyKey, unknown>)[FRAME_GEOMETRY_SYMBOL] as { getCommitted(frameId: number): CommittedFrameGeometry | undefined };
    provider.getCommitted = () => undefined;
    const violation = vi.fn();
    const { publisher, snapshots } = recorder();
    startSession({ renderer, publisher, sessionId: 's1', onGuaranteeViolation: violation });
    renderer.emit();
    renderer.emit();
    expect(snapshots).toHaveLength(0);
    expect(violation).toHaveBeenCalledOnce();
  });

  it('fails the certified contract instead of degrading when render order disappears', () => {
    const first = renderable('ButtonRenderable', 2);
    const second = renderable('ButtonRenderable', 3);
    const root = renderable('RootRenderable', 1, { getChildren: () => [first, second] });
    const renderer = fakeRenderer(root);
    const violation = vi.fn();
    const { publisher, snapshots } = recorder();
    startSession({ renderer, publisher, sessionId: 's1', onGuaranteeViolation: violation });
    renderer.emit();
    expect(snapshots).toHaveLength(0);
    expect(violation.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining('lost authoritative render order'),
    });
  });

  it('fails closed when native hitTest returns an unattributed renderable', () => {
    const renderer = fakeRenderer(renderable('RootRenderable', 1));
    renderer.hitTest = () => 999;
    const violation = vi.fn();
    const { publisher, snapshots } = recorder();
    startSession({ renderer, publisher, sessionId: 's1', onGuaranteeViolation: violation });
    renderer.emit();
    expect(snapshots).toHaveLength(0);
    expect(violation.mock.calls[0]?.[0]).toMatchObject({ message: expect.stringContaining('unknown renderable 999') });
  });
});
