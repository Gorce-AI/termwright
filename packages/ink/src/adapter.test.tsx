import { useRef } from 'react';
import { Box, Text, render, type DOMElement, type Instance } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { MARKER_OSC_PREFIX } from '@termwright/protocol';
import { semanticRender, useSemantic } from './index.js';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';
import { createFakeStdout, type FakeStdout } from './testing/fake-stdout.js';
import { markersIn, stripMarkers } from './testing/markers.js';

function Demo({ label }: { readonly label: string }): React.ReactNode {
  const ref = useRef<DOMElement>(null);
  useSemantic(ref, { role: 'button', name: label, testId: 'approve', state: { focused: true } });

  return (
    <Box flexDirection="column">
      <Box ref={ref} borderStyle="round">
        <Text>{label}</Text>
      </Box>
      <Box aria-role="progressbar" aria-state={{ busy: true }}>
        <Text>working</Text>
      </Box>
    </Box>
  );
}

const INK_OPTIONS = { interactive: true, patchConsole: false } as const;

describe('@termwright/ink', () => {
  const openApps: Instance[] = [];
  const openDrivers: FakeDriver[] = [];

  afterEach(async () => {
    for (const app of openApps.splice(0)) app.unmount();
    for (const driver of openDrivers.splice(0)) await driver.close();
  });

  async function launch(
    options: {
      readonly alternateScreen?: boolean;
      readonly driverOptions?: Parameters<typeof startFakeDriver>[0];
      readonly label?: string;
    } = {},
  ): Promise<{ driver: FakeDriver; app: Instance; stdout: FakeStdout }> {
    const driver = await startFakeDriver(options.driverOptions ?? {});
    openDrivers.push(driver);
    const stdout = createFakeStdout();
    const app = semanticRender(<Demo label={options.label ?? 'Approve'} />, {
      ...INK_OPTIONS,
      stdout,
      ...(options.alternateScreen === undefined ? {} : { alternateScreen: options.alternateScreen }),
      semantics: {
        env: {
          TERMWRIGHT_ENDPOINT: driver.endpoint,
          TERMWRIGHT_TOKEN: driver.token,
          TERMWRIGHT_PROTOCOL: '1',
        },
      },
    });
    openApps.push(app);
    return { driver, app, stdout };
  }

  describe('dormant rule', () => {
    it('produces byte-identical output and opens nothing without instrumentation env', async () => {
      const driver = await startFakeDriver();
      openDrivers.push(driver);

      const baselineStdout = createFakeStdout();
      const baseline = render(<Demo label="Approve" />, { ...INK_OPTIONS, stdout: baselineStdout });
      openApps.push(baseline);

      const dormantStdout = createFakeStdout();
      const dormant = semanticRender(<Demo label="Approve" />, {
        ...INK_OPTIONS,
        stdout: dormantStdout,
        semantics: { env: {} },
      });
      openApps.push(dormant);

      expect(dormantStdout.text).toBe(baselineStdout.text);
      expect(driver.hello).toBeUndefined();
    });

    it('stays dormant when the endpoint is set but the token is not', () => {
      const stdout = createFakeStdout();
      const app = semanticRender(<Demo label="Approve" />, {
        ...INK_OPTIONS,
        stdout,
        semantics: { env: { TERMWRIGHT_ENDPOINT: '/tmp/nope.sock' } },
      });
      openApps.push(app);

      expect(markersIn(stdout.text, 'x', 'x')).toEqual([]);
    });

    it('stays dormant for a protocol major version it does not speak', () => {
      const stdout = createFakeStdout();
      const app = semanticRender(<Demo label="Approve" />, {
        ...INK_OPTIONS,
        stdout,
        semantics: {
          env: {
            TERMWRIGHT_ENDPOINT: '/tmp/nope.sock',
            TERMWRIGHT_TOKEN: 'secret',
            TERMWRIGHT_PROTOCOL: '99',
          },
        },
      });
      openApps.push(app);

      expect(stdout.text).not.toContain(MARKER_OSC_PREFIX);
    });
  });

  describe('handshake', () => {
    it('announces the adapter and its capabilities', async () => {
      const { driver } = await launch({ alternateScreen: true });
      const hello = await driver.waitForHandshake();

      expect(hello.protocol).toBe('termwright/1');
      expect(hello.token).toBe(driver.token);
      expect(hello.adapter.name).toBe('@termwright/ink');
      expect(hello.capabilities).toEqual(
        expect.arrayContaining(['tree', 'bounds', 'states', 'actions', 'render-revisions']),
      );
    });

    it('claims absolute-bounds only in the alternate screen', async () => {
      const withAlt = await launch({ alternateScreen: true });
      expect((await withAlt.driver.waitForHandshake()).capabilities).toContain('absolute-bounds');

      const withoutAlt = await launch({ alternateScreen: false });
      expect((await withoutAlt.driver.waitForHandshake()).capabilities).not.toContain(
        'absolute-bounds',
      );
    });

    it('keeps the app running when the driver rejects the handshake', async () => {
      const { driver, app, stdout } = await launch({
        driverOptions: { rejectHandshake: true },
      });
      await driver.waitForHandshake();

      app.rerender(<Demo label="Reject" />);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(stdout.text).toContain('Reject');
      expect(driver.snapshots).toHaveLength(0);
    });
  });

  describe('publication', () => {
    it('publishes a snapshot and a revision commit per committed render', async () => {
      const { driver, app } = await launch({ alternateScreen: true });
      await driver.waitForSnapshots(1);

      app.rerender(<Demo label="Reject" />);
      const snapshots = await driver.waitForSnapshots(2);

      expect(snapshots[0]?.sessionId).toBe(driver.sessionId);
      expect(snapshots[1]!.revision).toBeGreaterThan(snapshots[0]!.revision);
      expect(driver.commits).toEqual(expect.arrayContaining(snapshots.map((s) => s.revision)));
    });

    it('resolves roles through annotation, then aria props, then generic', async () => {
      const { driver } = await launch({ alternateScreen: true });
      const [snapshot] = await driver.waitForSnapshots(1);

      const roles = snapshot!.nodes.map((node) => node.role);
      expect(roles).toContain('application');
      expect(roles).toContain('button');
      expect(roles).toContain('progressbar');
      expect(roles).toContain('text');
    });

    it('carries name, state, actions and testId from useSemantic', async () => {
      const { driver } = await launch({ alternateScreen: true });
      const [snapshot] = await driver.waitForSnapshots(1);

      const button = snapshot!.nodes.find((node) => node.role === 'button');
      expect(button).toBeDefined();
      expect(button?.name).toBe('Approve');
      expect(button?.testId).toBe('approve');
      expect(button?.state?.focused).toBe(true);
      expect(button?.actions).toEqual(['activate', 'focus']);
    });

    it('maps Ink aria-state onto protocol state', async () => {
      const { driver } = await launch({ alternateScreen: true });
      const [snapshot] = await driver.waitForSnapshots(1);

      const progress = snapshot!.nodes.find((node) => node.role === 'progressbar');
      expect(progress?.state?.busy).toBe(true);
      // Not a name-from-content role: its label would have to be annotated.
      expect(progress?.name).toBe('');
    });

    it('keeps node ids stable across revisions', async () => {
      const { driver, app } = await launch({ alternateScreen: true });
      await driver.waitForSnapshots(1);
      app.rerender(<Demo label="Reject" />);
      const snapshots = await driver.waitForSnapshots(2);

      const idOf = (snapshot: (typeof snapshots)[number]): string | undefined =>
        snapshot.nodes.find((node) => node.role === 'button')?.id;
      expect(idOf(snapshots[1]!)).toBe(idOf(snapshots[0]!));
    });

    it('answers get-tree for the latest revision and refuses forgotten ones', async () => {
      const { driver } = await launch({ alternateScreen: true });
      const [snapshot] = await driver.waitForSnapshots(1);

      const latest = await driver.requestTree();
      expect(latest.snapshot?.revision).toBe(snapshot!.revision);

      const ancient = await driver.requestTree(snapshot!.revision + 1000);
      expect(ancient.snapshot).toBeUndefined();
      expect(ancient.error).toBeDefined();
    });
  });

  describe('bounds', () => {
    it('reports viewport cell coordinates in the alternate screen', async () => {
      const { driver } = await launch({ alternateScreen: true });
      const [snapshot] = await driver.waitForSnapshots(1);

      const button = snapshot!.nodes.find((node) => node.role === 'button');
      expect(button?.bounds).toEqual({ row: 0, column: 0, width: 80, height: 3 });

      const progress = snapshot!.nodes.find((node) => node.role === 'progressbar');
      expect(progress?.bounds?.row).toBe(3);
    });
  });

  describe('marker', () => {
    it('emits the marker after the bytes of the render it commits', async () => {
      const { driver, app, stdout } = await launch({ alternateScreen: true });
      await driver.waitForSnapshots(1);
      app.rerender(<Demo label="Reject" />);
      await driver.waitForSnapshots(2);

      const output = stdout.text;
      const markers = markersIn(output, driver.token, driver.sessionId);
      expect(markers).toHaveLength(2);

      const firstFrame = output.indexOf('Approve');
      const secondFrame = output.indexOf('Reject');

      expect(firstFrame).toBeGreaterThanOrEqual(0);
      expect(firstFrame).toBeLessThan(markers[0]!.index);
      expect(markers[0]!.index).toBeLessThan(secondFrame);
      expect(secondFrame).toBeLessThan(markers[1]!.index);
      expect(markers[1]!.revision).toBeGreaterThan(markers[0]!.revision);
    });

    it('adds nothing to the frame apart from the marker', async () => {
      const baselineStdout = createFakeStdout();
      const baseline = render(<Demo label="Approve" />, {
        ...INK_OPTIONS,
        alternateScreen: true,
        stdout: baselineStdout,
      });
      openApps.push(baseline);

      const { driver, stdout } = await launch({ alternateScreen: true });
      await driver.waitForSnapshots(1);

      expect(stripMarkers(stdout.text)).toBe(baselineStdout.text);
    });

    it('does not emit a marker when the driver disabled it', async () => {
      const { driver, stdout } = await launch({
        alternateScreen: true,
        driverOptions: { markerEnabled: false },
      });
      await driver.waitForSnapshots(1);

      expect(stdout.text).not.toContain(MARKER_OSC_PREFIX);
    });
  });

  describe('resilience', () => {
    it('keeps rendering after the channel is cut mid-session', async () => {
      const { driver, app, stdout } = await launch({ alternateScreen: true });
      await driver.waitForSnapshots(1);

      driver.cutConnection();
      await new Promise((resolve) => setTimeout(resolve, 20));

      app.rerender(<Demo label="Reject" />);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(stdout.text).toContain('Reject');
      expect(driver.snapshots).toHaveLength(1);
    });

    it('keeps rendering when the endpoint does not exist at all', async () => {
      const stdout = createFakeStdout();
      const app = semanticRender(<Demo label="Approve" />, {
        ...INK_OPTIONS,
        stdout,
        semantics: {
          env: {
            TERMWRIGHT_ENDPOINT: '/tmp/termwright-does-not-exist.sock',
            TERMWRIGHT_TOKEN: 'secret',
          },
          handshakeTimeoutMs: 50,
        },
      });
      openApps.push(app);

      await new Promise((resolve) => setTimeout(resolve, 120));
      app.rerender(<Demo label="Reject" />);

      expect(stdout.text).toContain('Reject');
      expect(stdout.text).not.toContain(MARKER_OSC_PREFIX);
    });
  });
});
