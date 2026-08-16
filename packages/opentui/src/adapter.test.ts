import { afterEach, describe, expect, it } from 'vitest';
import { ENV_ENDPOINT, ENV_PROTOCOL, ENV_TOKEN, validateSnapshot, DEFAULT_LIMITS } from '@termwright/protocol';
import { describeRenderable, instrumentRenderer, type SemanticSession } from './instrument.js';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';
import { markersIn, stripMarkers, waitForMarkers } from './testing/markers.js';
import { FakeRenderable, FakeRenderer } from './testing/fake-renderer.js';

const sessions: SemanticSession[] = [];
const drivers: FakeDriver[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const driver of drivers.splice(0)) await driver.close();
});

async function driverFor(options: Parameters<typeof startFakeDriver>[0] = {}): Promise<FakeDriver> {
  const driver = await startFakeDriver(options);
  drivers.push(driver);
  return driver;
}

function instrument(renderer: FakeRenderer, driver: FakeDriver): SemanticSession {
  const session = instrumentRenderer(renderer, {
    env: {
      [ENV_ENDPOINT]: driver.endpoint,
      [ENV_TOKEN]: driver.token,
      [ENV_PROTOCOL]: '1',
    },
    stdout: renderer.stdout,
    handshakeTimeoutMs: 5_000,
  });
  sessions.push(session);
  return session;
}

/** A renderer with one annotated button, ready to commit frames. */
function scene(): { renderer: FakeRenderer; button: FakeRenderable } {
  const renderer = new FakeRenderer({ columns: 40, rows: 10 });
  const button = renderer.root.add(
    new FakeRenderable({ id: 'approve', screenX: 4, screenY: 2, width: 11, height: 1 }),
  );
  return { renderer, button };
}

describe('the dormant rule', () => {
  it('opens nothing and touches nothing without an environment', () => {
    const renderer = new FakeRenderer();
    const session = instrumentRenderer(renderer, { env: {} });

    expect(session.active).toBe(false);
    expect(renderer.listenerCount('frame')).toBe(0);

    renderer.commit('frame-bytes');
    expect(renderer.output()).toBe('frame-bytes');
    expect(session.describe(renderer.root, { role: 'button' })).toBeTypeOf('function');
    session.dispose();
  });

  it('leaves describeRenderable a no-op outside a session', () => {
    const node = new FakeRenderable();
    expect(() => describeRenderable(node, { role: 'button', name: 'x' })()).not.toThrow();
  });

  it('stays quiet when the endpoint is unreachable', async () => {
    const renderer = new FakeRenderer();
    const session = instrumentRenderer(renderer, {
      env: { [ENV_ENDPOINT]: '/nonexistent/termwright.sock', [ENV_TOKEN]: 't' },
      stdout: renderer.stdout,
      handshakeTimeoutMs: 200,
    });
    sessions.push(session);

    renderer.commit('a');
    await new Promise((resolve) => setTimeout(resolve, 350));
    renderer.commit('b');

    expect(renderer.output()).toBe('ab');
  });
});

describe('an instrumented session', () => {
  it('completes the handshake and announces what it can do', async () => {
    const driver = await driverFor();
    const { renderer } = scene();
    instrument(renderer, driver);

    const hello = await driver.waitForHandshake();
    expect(hello.adapter.name).toBe('@termwright/opentui');
    expect(hello.capabilities).toContain('tree');
    expect(hello.capabilities).toContain('render-revisions');
    expect(hello.capabilities).toContain('absolute-bounds');
  });

  it('drops the absolute-bounds claim outside the alternate screen', async () => {
    const driver = await driverFor();
    const renderer = new FakeRenderer({ screenMode: 'main-screen' });
    instrument(renderer, driver);

    const hello = await driver.waitForHandshake();
    expect(hello.capabilities).not.toContain('absolute-bounds');
  });

  it('publishes a valid snapshot per committed frame, in revision order', async () => {
    const driver = await driverFor();
    const { renderer, button } = scene();
    const session = instrument(renderer, driver);
    await driver.waitForHandshake();

    session.describe(button, { role: 'button', name: 'Approve' });
    // One frame at a time: a frame superseded before its snapshot is pushed is
    // dropped by design, and a real render loop never commits two within the
    // same microtask.
    renderer.commit('frame-1');
    await driver.waitForSnapshots(1);
    renderer.commit('frame-2');

    const snapshots = await driver.waitForSnapshots(2);
    const revisions = snapshots.map((snapshot) => snapshot.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(new Set(revisions).size).toBe(revisions.length);

    for (const snapshot of snapshots) {
      expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
      expect(snapshot.sessionId).toBe(driver.sessionId);
      expect(snapshot.columns).toBe(40);
    }

    const last = snapshots.at(-1);
    expect(last?.nodes.find((node) => node.name === 'Approve')).toMatchObject({
      role: 'button',
      bounds: { row: 2, column: 4, width: 11, height: 1 },
    });
  });

  it('writes the marker after the bytes of the frame it commits', async () => {
    const driver = await driverFor();
    const { renderer, button } = scene();
    const session = instrument(renderer, driver);
    await driver.waitForHandshake();
    session.describe(button, { role: 'button', name: 'Approve' });

    renderer.commit('FRAME-ONE');
    await driver.waitForSnapshots(1);
    renderer.commit('FRAME-TWO');
    await driver.waitForSnapshots(2);

    // The marker lands after its snapshot and after the stream drains, so the
    // snapshot it follows proves nothing about it; it has to be waited for on
    // its own terms rather than read once.
    const markers = await waitForMarkers(() => renderer.output(), driver.token, driver.sessionId, 2);
    const output = renderer.output();
    expect(markers.length).toBeGreaterThanOrEqual(2);

    for (const marker of markers) {
      const frame = marker.revision === 1 ? 'FRAME-ONE' : 'FRAME-TWO';
      const frameIndex = output.indexOf(frame);
      if (frameIndex < 0) continue;
      expect(marker.index).toBeGreaterThan(frameIndex);
    }
    // The marker is the only thing the adapter adds to the stream.
    expect(stripMarkers(output)).toBe('FRAME-ONEFRAME-TWO');
  });

  it('answers get-tree for the revision it last published', async () => {
    const driver = await driverFor();
    const { renderer, button } = scene();
    const session = instrument(renderer, driver);
    await driver.waitForHandshake();
    session.describe(button, { role: 'button', name: 'Approve' });

    renderer.commit();
    const [snapshot] = await driver.waitForSnapshots(1);

    const answer = await driver.requestTree(snapshot?.revision);
    expect(answer.snapshot?.revision).toBe(snapshot?.revision);

    const stale = await driver.requestTree(9_999);
    expect(stale.snapshot).toBeUndefined();
    expect(stale.error).toBeTypeOf('string');
  });

  it('sends revision commits even when the driver only subscribes to those', async () => {
    const driver = await driverFor({ subscribe: 'revisions' });
    const { renderer } = scene();
    instrument(renderer, driver);
    await driver.waitForHandshake();

    // Two separate revisions, so the pause between them stays: back-to-back
    // commits are one publication.
    renderer.commit();
    await settle();
    renderer.commit();

    // Waited for, not settled into: the commit is its own frame, and a fixed
    // pause only reaches it wherever the transport hands both writes over at
    // once. That is how the sibling adapter's version of this failed on
    // Windows named pipes.
    const commits = await driver.waitForCommits(2);
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(driver.snapshots).toHaveLength(0);
  });

  it('emits no marker when the driver disabled it', async () => {
    const driver = await driverFor({ markerEnabled: false });
    const { renderer } = scene();
    instrument(renderer, driver);
    await driver.waitForHandshake();

    renderer.commit('only-frame');
    await driver.waitForSnapshots(1);
    await settle();

    expect(renderer.output()).toBe('only-frame');
  });
});

describe('surviving the driver', () => {
  it('keeps rendering after the channel is cut', async () => {
    const driver = await driverFor();
    const { renderer } = scene();
    instrument(renderer, driver);
    await driver.waitForHandshake();

    renderer.commit('before');
    await driver.waitForSnapshots(1);
    // Cutting before the first marker has been written would make the rest of
    // this vacuous: the publisher suppresses markers once the channel is gone,
    // so `beforeCut` has to be a stream that already contains one.
    await waitForMarkers(() => renderer.output(), driver.token, driver.sessionId, 1);

    driver.cutConnection();
    await settle();

    const beforeCut = renderer.output();
    renderer.commit('after');
    await settle();

    expect(renderer.output()).toBe(`${beforeCut}after`);
    expect(markersIn(renderer.output().slice(beforeCut.length), driver.token, driver.sessionId)).toHaveLength(0);
  });

  it('goes dormant when the handshake is rejected', async () => {
    const driver = await driverFor({ rejectHandshake: true });
    const { renderer } = scene();
    instrument(renderer, driver);
    await driver.waitForHandshake();
    await settle();

    renderer.commit('frame');
    await settle();

    expect(renderer.output()).toBe('frame');
  });
});

/** Let the publication queue and the stream drain callbacks run out. */
async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
}
