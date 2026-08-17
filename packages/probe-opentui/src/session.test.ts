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
function fakeRenderer(root: ObservableNode): ObservableRenderer & { emit(): void } {
  const handlers: (() => void)[] = [];
  return {
    root,
    width: 80,
    height: 24,
    on: (_event, handler) => handlers.push(handler),
    emit: () => {
      for (const handler of [...handlers]) handler();
    },
  };
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
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
    expect(snapshot.nodes.map((node) => node.role)).toEqual(['application', 'textbox', 'text']);
    expect(snapshot.nodes[1]?.value).toBe('draft');
  });
});
