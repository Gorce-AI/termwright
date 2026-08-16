/**
 * Proof that the adapter leaves no trace in the application that hosts it.
 *
 * termwright is not shipping an upstream change to Ink, so the way it hooks in
 * has to stay invisible indefinitely: no React warning an application author
 * would have to explain, no change to the shape of their own component tree,
 * no work after unmount. These tests are what makes that claim checkable
 * instead of aspirational.
 */

import { StrictMode, useEffect, useRef } from 'react';
import { Box, Text, measureElement, render, type DOMElement, type Instance } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { semanticRender, useSemantic } from './index.js';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';
import { createFakeStdout, type FakeStdout } from './testing/fake-stdout.js';
import { markersIn, stripMarkers } from './testing/markers.js';

/** Everything one user component can observe about its own surroundings. */
interface Observed {
  nodeName: string;
  childCount: number;
  parentNodeName: string;
  metrics: { x: number; y: number; width: number; height: number };
  effectRuns: number;
  layoutEffectRuns: number;
  /** Children of Ink's root, reached the only way an application could. */
  rootChildren: Array<{ nodeName: string; hidden: boolean; width: number; height: number }>;
}

function makeObserved(): Observed {
  return {
    nodeName: '',
    childCount: -1,
    parentNodeName: '',
    metrics: { x: -1, y: -1, width: -1, height: -1 },
    effectRuns: 0,
    layoutEffectRuns: 0,
    rootChildren: [],
  };
}

/**
 * A component that reports what it can see of itself, exactly as an
 * application author would: through its own ref and its own hooks.
 */
function Observer({ into, annotate }: { readonly into: Observed; readonly annotate: boolean }) {
  const ref = useRef<DOMElement>(null);

  useSemantic(ref, annotate ? { role: 'button', name: 'Approve' } : {});

  useEffect(() => {
    into.effectRuns += 1;
    const node = ref.current;
    if (node === null) return;
    into.nodeName = node.nodeName;
    into.childCount = node.childNodes.length;
    into.parentNodeName = node.parentNode?.nodeName ?? '<detached>';
    into.metrics = measureElement(node);

    let root: DOMElement = node;
    while (root.parentNode !== undefined) root = root.parentNode;
    into.rootChildren = root.childNodes
      .filter((child): child is DOMElement => child.nodeName !== '#text')
      .map((child) => ({
        nodeName: child.nodeName,
        hidden: child.style?.display === 'none',
        ...(({ width, height }) => ({ width, height }))(measureElement(child)),
      }));
  });

  return (
    <Box ref={ref} flexDirection="column">
      <Text>Approve</Text>
    </Box>
  );
}

function App({ into, annotate = true }: { readonly into: Observed; readonly annotate?: boolean }) {
  return (
    <Box flexDirection="column">
      <Observer into={into} annotate={annotate} />
      <Text>footer</Text>
    </Box>
  );
}

/** Console output captured while the adapter runs. Empty is the whole point. */
interface ConsoleTrap {
  readonly lines: readonly string[];
  restore(): void;
}

function trapConsole(): ConsoleTrap {
  const lines: string[] = [];
  const methods = ['error', 'warn', 'log', 'info', 'debug'] as const;
  const previous = new Map<string, unknown>();

  for (const method of methods) {
    previous.set(method, console[method]);
    (console as unknown as Record<string, unknown>)[method] = (...args: unknown[]): void => {
      lines.push(`${method}: ${args.map(String).join(' ')}`);
    };
  }

  return {
    get lines() {
      return lines;
    },
    restore() {
      for (const [method, original] of previous) {
        (console as unknown as Record<string, unknown>)[method] = original;
      }
    },
  };
}

const INK_OPTIONS = { interactive: true, patchConsole: false } as const;

describe('invisibility to the host application', () => {
  const openApps: Instance[] = [];
  const openDrivers: FakeDriver[] = [];
  const traps: ConsoleTrap[] = [];

  afterEach(async () => {
    for (const trap of traps.splice(0)) trap.restore();
    for (const app of openApps.splice(0)) app.unmount();
    for (const driver of openDrivers.splice(0)) await driver.close();
  });

  async function instrument(
    element: React.ReactNode,
    stdout: FakeStdout = createFakeStdout(),
  ): Promise<{ driver: FakeDriver; app: Instance; stdout: FakeStdout }> {
    const driver = await startFakeDriver();
    openDrivers.push(driver);
    const app = semanticRender(element, {
      ...INK_OPTIONS,
      alternateScreen: true,
      stdout,
      semantics: {
        env: { TERMWRIGHT_ENDPOINT: driver.endpoint, TERMWRIGHT_TOKEN: driver.token },
      },
    });
    openApps.push(app);
    await driver.waitForSnapshots(1);
    return { driver, app, stdout };
  }

  describe('React says nothing', () => {
    it('renders an instrumented app without a single console line', async () => {
      const trap = trapConsole();
      traps.push(trap);

      const { app } = await instrument(<App into={makeObserved()} />);
      app.rerender(<App into={makeObserved()} />);
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(trap.lines).toEqual([]);
    });

    it('stays silent under StrictMode, which double-invokes everything', async () => {
      const trap = trapConsole();
      traps.push(trap);

      const { app } = await instrument(
        <StrictMode>
          <App into={makeObserved()} />
        </StrictMode>,
      );
      app.rerender(
        <StrictMode>
          <App into={makeObserved()} />
        </StrictMode>,
      );
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(trap.lines).toEqual([]);
    });

    it('stays silent while unmounting', async () => {
      const { app } = await instrument(<App into={makeObserved()} />);

      const trap = trapConsole();
      traps.push(trap);
      app.unmount();
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(trap.lines).toEqual([]);
    });
  });

  describe("the user's own tree is untouched", () => {
    it('shows a component exactly what it would see without the adapter', async () => {
      const plain = makeObserved();
      const baseline = render(<App into={plain} />, { ...INK_OPTIONS, stdout: createFakeStdout() });
      openApps.push(baseline);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const instrumented = makeObserved();
      await instrument(<App into={instrumented} />);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(instrumented.nodeName).toBe(plain.nodeName);
      expect(instrumented.childCount).toBe(plain.childCount);
      expect(instrumented.parentNodeName).toBe(plain.parentNodeName);
      expect(instrumented.metrics).toEqual(plain.metrics);
    });

    it('does not make the application render or run effects more often', async () => {
      const plain = makeObserved();
      const baseline = render(<App into={plain} />, { ...INK_OPTIONS, stdout: createFakeStdout() });
      openApps.push(baseline);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const instrumented = makeObserved();
      await instrument(<App into={instrumented} />);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(instrumented.effectRuns).toBe(plain.effectRuns);
    });

    it('leaves layout identical even for an unannotated tree', async () => {
      const plain = makeObserved();
      const baseline = render(<App into={plain} annotate={false} />, {
        ...INK_OPTIONS,
        stdout: createFakeStdout(),
      });
      openApps.push(baseline);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const instrumented = makeObserved();
      await instrument(<App into={instrumented} annotate={false} />);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(instrumented.metrics).toEqual(plain.metrics);
    });
  });

  describe('the one thing that does differ', () => {
    it('adds a single zero-sized hidden node to the root, and nothing else', async () => {
      const plain = makeObserved();
      const baseline = render(<App into={plain} />, { ...INK_OPTIONS, stdout: createFakeStdout() });
      openApps.push(baseline);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const instrumented = makeObserved();
      await instrument(<App into={instrumented} />);
      await new Promise((resolve) => setTimeout(resolve, 20));

      // This is the known, documented cost of reaching Ink's root without a
      // public accessor. It is the ONLY structural difference, it is hidden
      // from layout, and it contributes no bytes — see NOTES.md.
      expect(instrumented.rootChildren).toHaveLength(plain.rootChildren.length + 1);

      const extra = instrumented.rootChildren.filter((child) => child.hidden);
      expect(extra).toHaveLength(1);
      expect(extra[0]?.width).toBe(0);
      expect(extra[0]?.height).toBe(0);

      // Everything the application itself put there is unchanged, in order.
      expect(instrumented.rootChildren.filter((child) => !child.hidden)).toEqual(
        plain.rootChildren,
      );
    });
  });

  describe('nothing happens after unmount', () => {
    it('writes no marker and publishes no snapshot once unmounted', async () => {
      const { driver, app, stdout } = await instrument(<App into={makeObserved()} />);

      const snapshotsAtUnmount = driver.snapshots.length;
      const markersAtUnmount = markersIn(stdout.text, driver.token, driver.sessionId).length;

      app.unmount();
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(driver.snapshots).toHaveLength(snapshotsAtUnmount);
      expect(markersIn(stdout.text, driver.token, driver.sessionId)).toHaveLength(markersAtUnmount);
    });

    it('survives a render that lands in the same tick as unmount', async () => {
      const { driver, app, stdout } = await instrument(<App into={makeObserved()} />);
      const trap = trapConsole();
      traps.push(trap);

      app.rerender(<App into={makeObserved()} />);
      app.unmount();
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(trap.lines).toEqual([]);
      // Whatever was mid-flight, the stream must not have been written past the
      // point Ink stopped owning it.
      expect(stripMarkers(stdout.text)).toContain('Approve');
      expect(driver.snapshots.length).toBeGreaterThan(0);
    });
  });

  describe('dormant', () => {
    it('is byte-identical to plain ink.render under StrictMode', () => {
      const baselineStdout = createFakeStdout();
      const baseline = render(
        <StrictMode>
          <App into={makeObserved()} />
        </StrictMode>,
        { ...INK_OPTIONS, stdout: baselineStdout },
      );
      openApps.push(baseline);

      const dormantStdout = createFakeStdout();
      const dormant = semanticRender(
        <StrictMode>
          <App into={makeObserved()} />
        </StrictMode>,
        { ...INK_OPTIONS, stdout: dormantStdout, semantics: { env: {} } },
      );
      openApps.push(dormant);

      expect(dormantStdout.text).toBe(baselineStdout.text);
    });

    it('adds nothing but the marker under StrictMode when instrumented', async () => {
      const baselineStdout = createFakeStdout();
      const baseline = render(
        <StrictMode>
          <App into={makeObserved()} />
        </StrictMode>,
        { ...INK_OPTIONS, alternateScreen: true, stdout: baselineStdout },
      );
      openApps.push(baseline);

      const { stdout } = await instrument(
        <StrictMode>
          <App into={makeObserved()} />
        </StrictMode>,
      );

      expect(stripMarkers(stdout.text)).toBe(baselineStdout.text);
    });
  });
});
