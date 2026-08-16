import { useEffect, useRef } from 'react';
import { Box, Text, render, useFocus, type DOMElement, type Instance } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import type { SemanticSnapshot } from '@termwright/protocol';
import { Semantic, semanticRender } from './index.js';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';
import { createFakeStdout, type FakeStdout } from './testing/fake-stdout.js';

const INK_OPTIONS = { interactive: true, patchConsole: false, alternateScreen: true } as const;

describe('<Semantic>', () => {
  const openApps: Instance[] = [];
  const openDrivers: FakeDriver[] = [];

  afterEach(async () => {
    for (const app of openApps.splice(0)) app.unmount();
    for (const driver of openDrivers.splice(0)) await driver.close();
  });

  async function snapshotOf(
    element: React.ReactNode,
    stdout: FakeStdout = createFakeStdout(),
  ): Promise<SemanticSnapshot> {
    const driver = await startFakeDriver();
    openDrivers.push(driver);
    const app = semanticRender(element, {
      ...INK_OPTIONS,
      stdout,
      semantics: {
        env: { TERMWRIGHT_ENDPOINT: driver.endpoint, TERMWRIGHT_TOKEN: driver.token },
      },
    });
    openApps.push(app);
    const [snapshot] = await driver.waitForSnapshots(1);
    return snapshot as SemanticSnapshot;
  }

  describe('annotation', () => {
    it('describes the element its child renders, with no hook or ref in sight', async () => {
      const snapshot = await snapshotOf(
        <Semantic role="button" name="Approve" testId="approve" state={{ focused: true }}>
          <Box>
            <Text>Approve</Text>
          </Box>
        </Semantic>,
      );

      const button = snapshot.nodes.find((node) => node.role === 'button');
      expect(button?.name).toBe('Approve');
      expect(button?.testId).toBe('approve');
      expect(button?.state?.focused).toBe(true);
      expect(button?.actions).toEqual(['activate', 'focus']);
    });

    it('carries real bounds, because it annotates a real element', async () => {
      const snapshot = await snapshotOf(
        <Box flexDirection="column">
          <Text>header</Text>
          <Semantic role="button" name="Approve">
            <Box borderStyle="round">
              <Text>Approve</Text>
            </Box>
          </Semantic>
        </Box>,
      );

      const button = snapshot.nodes.find((node) => node.role === 'button');
      expect(button?.bounds).toEqual({ row: 1, column: 0, width: 80, height: 3 });
    });

    it('accepts explicit actions over the role defaults', async () => {
      const snapshot = await snapshotOf(
        <Semantic role="button" name="Save" actions={['activate']}>
          <Box>
            <Text>Save</Text>
          </Box>
        </Semantic>,
      );

      expect(snapshot.nodes.find((node) => node.role === 'button')?.actions).toEqual(['activate']);
    });
  });

  describe('nesting', () => {
    it('parents a nested annotation under the enclosing one', async () => {
      const snapshot = await snapshotOf(
        <Semantic role="dialog" name="Permission" state={{ modal: true }}>
          <Box flexDirection="column">
            <Semantic role="button" name="Approve">
              <Box>
                <Text>Approve</Text>
              </Box>
            </Semantic>
          </Box>
        </Semantic>,
      );

      const dialog = snapshot.nodes.find((node) => node.role === 'dialog');
      const button = snapshot.nodes.find((node) => node.role === 'button');
      expect(dialog?.state?.modal).toBe(true);
      expect(button?.parentId).toBe(dialog?.id);
    });

    it('keeps a list and its items in the right relation', async () => {
      const items = ['one', 'two', 'three'];
      const snapshot = await snapshotOf(
        <Semantic role="list" name="Choices">
          <Box flexDirection="column">
            {items.map((item) => (
              <Semantic key={item} role="listitem" name={item}>
                <Box>
                  <Text>{item}</Text>
                </Box>
              </Semantic>
            ))}
          </Box>
        </Semantic>,
      );

      const list = snapshot.nodes.find((node) => node.role === 'list');
      const listItems = snapshot.nodes.filter((node) => node.role === 'listitem');
      expect(listItems).toHaveLength(3);
      expect(listItems.map((node) => node.name)).toEqual(items);
      expect(listItems.every((node) => node.parentId === list?.id)).toBe(true);
    });
  });

  describe('composition with the application', () => {
    it('does not steal a ref the application put on the same element', async () => {
      const seen: { current: DOMElement | null } = { current: null };

      function WithOwnRef() {
        const ref = useRef<DOMElement>(null);
        useEffect(() => {
          seen.current = ref.current;
        });
        return (
          <Semantic role="button" name="Approve">
            <Box ref={ref}>
              <Text>Approve</Text>
            </Box>
          </Semantic>
        );
      }

      const snapshot = await snapshotOf(<WithOwnRef />);

      expect(seen.current?.nodeName).toBe('ink-box');
      expect(snapshot.nodes.find((node) => node.role === 'button')?.name).toBe('Approve');
    });

    it('renders a child it cannot annotate instead of throwing', async () => {
      // `<Text>` takes no ref, so there is nothing to attach semantics to. The
      // text must still render, and the adapter must stay quiet about it.
      const stdout = createFakeStdout();
      const snapshot = await snapshotOf(
        <Semantic role="button" name="Impossible">
          <Text>still visible</Text>
        </Semantic>,
        stdout,
      );

      expect(stdout.text).toContain('still visible');
      expect(snapshot.nodes.some((node) => node.role === 'button')).toBe(false);
    });
  });

  describe('adds nothing to the output', () => {
    it('renders byte-identically to the same tree without it', () => {
      const annotated = (
        <Box flexDirection="column">
          <Semantic role="button" name="Approve">
            <Box borderStyle="round">
              <Text>Approve</Text>
            </Box>
          </Semantic>
          <Text>footer</Text>
        </Box>
      );
      const plain = (
        <Box flexDirection="column">
          <Box borderStyle="round">
            <Text>Approve</Text>
          </Box>
          <Text>footer</Text>
        </Box>
      );

      const annotatedStdout = createFakeStdout();
      openApps.push(render(annotated, { ...INK_OPTIONS, stdout: annotatedStdout }));

      const plainStdout = createFakeStdout();
      openApps.push(render(plain, { ...INK_OPTIONS, stdout: plainStdout }));

      expect(annotatedStdout.text).toBe(plainStdout.text);
    });

    // Equivalence, not a sensitivity check: a plain layout Box is not published
    // either, so this would survive an extra wrapper. Byte identity above is
    // what actually pins that down.
    it('produces the same tree shape as the native aria path', async () => {
      const withWrapper = await snapshotOf(
        <Box flexDirection="column">
          <Semantic role="button" name="Approve">
            <Box>
              <Text>Approve</Text>
            </Box>
          </Semantic>
        </Box>,
      );
      const withoutWrapper = await snapshotOf(
        <Box flexDirection="column">
          <Box aria-role="button">
            <Text>Approve</Text>
          </Box>
        </Box>,
      );

      expect(withWrapper.nodes).toHaveLength(withoutWrapper.nodes.length);
    });
  });

  describe('the native aria path needs none of our API', () => {
    it('reads aria-role and aria-state straight off Box', async () => {
      const snapshot = await snapshotOf(
        <Box flexDirection="column">
          <Box aria-role="checkbox" aria-state={{ checked: true, disabled: true }}>
            <Text>Remember me</Text>
          </Box>
          <Box aria-role="progressbar" aria-state={{ busy: true }}>
            <Text>Loading</Text>
          </Box>
        </Box>,
      );

      const checkbox = snapshot.nodes.find((node) => node.role === 'checkbox');
      expect(checkbox?.name).toBe('Remember me');
      expect(checkbox?.state?.checked).toBe(true);
      expect(checkbox?.state?.disabled).toBe(true);
      expect(checkbox?.actions).toEqual(['toggle', 'focus']);

      expect(snapshot.nodes.find((node) => node.role === 'progressbar')?.state?.busy).toBe(true);
    });

    it('lets an explicit annotation win over the aria props on the same element', async () => {
      const snapshot = await snapshotOf(
        <Semantic role="menuitem" name="Explicit">
          <Box aria-role="button" aria-state={{ disabled: true }}>
            <Text>Native</Text>
          </Box>
        </Semantic>,
      );

      const node = snapshot.nodes.find((candidate) => candidate.role === 'menuitem');
      expect(node?.name).toBe('Explicit');
      // The aria state still contributes what the annotation did not override.
      expect(node?.state?.disabled).toBe(true);
      expect(snapshot.nodes.some((candidate) => candidate.role === 'button')).toBe(false);
    });
  });
});

describe('naming rules', () => {
  const openApps: Instance[] = [];
  const openDrivers: FakeDriver[] = [];

  afterEach(async () => {
    for (const app of openApps.splice(0)) app.unmount();
    for (const driver of openDrivers.splice(0)) await driver.close();
  });

  async function snapshot(element: React.ReactNode): Promise<SemanticSnapshot> {
    const driver = await startFakeDriver();
    openDrivers.push(driver);
    const app = semanticRender(element, {
      ...INK_OPTIONS,
      stdout: createFakeStdout(),
      semantics: {
        env: { TERMWRIGHT_ENDPOINT: driver.endpoint, TERMWRIGHT_TOKEN: driver.token },
      },
    });
    openApps.push(app);
    const [first] = await driver.waitForSnapshots(1);
    return first as SemanticSnapshot;
  }

  it('names name-from-content roles from the text they contain', async () => {
    const tree = await snapshot(
      <Box flexDirection="column">
        <Semantic role="button">
          <Box>
            <Text>Approve</Text>
          </Box>
        </Semantic>
        <Semantic role="listitem">
          <Box>
            <Text>First item</Text>
          </Box>
        </Semantic>
        <Semantic role="heading">
          <Box>
            <Text>Settings</Text>
          </Box>
        </Semantic>
      </Box>,
    );

    const named = (role: string) => tree.nodes.find((node) => node.role === role)?.name;
    expect(named('button')).toBe('Approve');
    expect(named('listitem')).toBe('First item');
    expect(named('heading')).toBe('Settings');
  });

  it('never names a container from its content', async () => {
    const tree = await snapshot(
      <Semantic role="dialog">
        <Box flexDirection="column">
          <Semantic role="region">
            <Box>
              <Semantic role="button">
                <Box>
                  <Text>Approve</Text>
                </Box>
              </Semantic>
            </Box>
          </Semantic>
        </Box>
      </Semantic>,
    );

    // This is the whole point: a locator for a region named "Approve" must not
    // match every ancestor of the Approve button.
    expect(tree.nodes.find((node) => node.role === 'dialog')?.name).toBe('');
    expect(tree.nodes.find((node) => node.role === 'region')?.name).toBe('');
    expect(tree.nodes.find((node) => node.role === 'button')?.name).toBe('Approve');
  });

  it('lets an explicit name label a container, including an empty one', async () => {
    const tree = await snapshot(
      <Semantic role="dialog" name="Permission">
        <Box>
          <Text>Allow?</Text>
        </Box>
      </Semantic>,
    );

    expect(tree.nodes.find((node) => node.role === 'dialog')?.name).toBe('Permission');
  });

  it('still names text nodes from their own string', async () => {
    const tree = await snapshot(
      <Box>
        <Text>plain text</Text>
      </Box>,
    );

    expect(tree.nodes.find((node) => node.role === 'text')?.name).toBe('plain text');
  });
});

describe('focus, read from Ink rather than guessed', () => {
  const openApps: Instance[] = [];
  const openDrivers: FakeDriver[] = [];

  afterEach(async () => {
    for (const app of openApps.splice(0)) app.unmount();
    for (const driver of openDrivers.splice(0)) await driver.close();
  });

  /** Two focusables, the first auto-focused, each linked by its `useFocus` id. */
  function FocusDemo() {
    useFocus({ id: 'first', autoFocus: true });
    useFocus({ id: 'second' });
    return (
      <Box flexDirection="column">
        <Semantic role="button" focusId="first">
          <Box>
            <Text>First</Text>
          </Box>
        </Semantic>
        <Semantic role="button" focusId="second">
          <Box>
            <Text>Second</Text>
          </Box>
        </Semantic>
      </Box>
    );
  }

  it('derives focused from the active focusable', async () => {
    const driver = await startFakeDriver();
    openDrivers.push(driver);
    const app = semanticRender(<FocusDemo />, {
      ...INK_OPTIONS,
      stdout: createFakeStdout(),
      semantics: {
        env: { TERMWRIGHT_ENDPOINT: driver.endpoint, TERMWRIGHT_TOKEN: driver.token },
      },
    });
    openApps.push(app);

    const [snapshot] = await driver.waitForSnapshots(1);
    const byName = (name: string) =>
      (snapshot as SemanticSnapshot).nodes.find((node) => node.name === name);

    expect(byName('First')?.state?.focused).toBe(true);
    expect(byName('Second')?.state?.focused).toBe(false);
  });

  it('reports nothing when the annotation names no focusable', async () => {
    const driver = await startFakeDriver();
    openDrivers.push(driver);
    const app = semanticRender(
      <Semantic role="button">
        <Box>
          <Text>Unlinked</Text>
        </Box>
      </Semantic>,
      {
        ...INK_OPTIONS,
        stdout: createFakeStdout(),
        semantics: {
          env: { TERMWRIGHT_ENDPOINT: driver.endpoint, TERMWRIGHT_TOKEN: driver.token },
        },
      },
    );
    openApps.push(app);

    const [snapshot] = await driver.waitForSnapshots(1);
    // Omitted, not guessed false: the framework never said.
    expect((snapshot as SemanticSnapshot).nodes.find((n) => n.name === 'Unlinked')?.state)
      .toBeUndefined();
  });
});
