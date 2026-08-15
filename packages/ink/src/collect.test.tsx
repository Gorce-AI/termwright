import { useRef } from 'react';
import { Box, Static, Text, type DOMElement, type Instance } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, type SemanticSnapshot } from '@termwright/protocol';
import { semanticRender, useSemantic } from './index.js';
import { startFakeDriver, type FakeDriver, type FakeDriverOptions } from './testing/fake-driver.js';
import { createFakeStdout } from './testing/fake-stdout.js';

function Annotated({
  name,
  children,
}: {
  readonly name: string;
  readonly children?: React.ReactNode;
}): React.ReactNode {
  const ref = useRef<DOMElement>(null);
  useSemantic(ref, { role: 'button', name });
  return <Box ref={ref}>{children ?? <Text>{name}</Text>}</Box>;
}

describe('snapshot collection', () => {
  const openApps: Instance[] = [];
  const openDrivers: FakeDriver[] = [];

  afterEach(async () => {
    for (const app of openApps.splice(0)) app.unmount();
    for (const driver of openDrivers.splice(0)) await driver.close();
  });

  async function firstSnapshot(
    element: React.ReactNode,
    driverOptions: FakeDriverOptions = {},
  ): Promise<SemanticSnapshot> {
    const driver = await startFakeDriver(driverOptions);
    openDrivers.push(driver);
    const app = semanticRender(element, {
      stdout: createFakeStdout(),
      interactive: true,
      alternateScreen: true,
      patchConsole: false,
      semantics: {
        env: { TERMWRIGHT_ENDPOINT: driver.endpoint, TERMWRIGHT_TOKEN: driver.token },
      },
    });
    openApps.push(app);
    const [snapshot] = await driver.waitForSnapshots(1);
    return snapshot as SemanticSnapshot;
  }

  it('skips hidden subtrees entirely', async () => {
    const snapshot = await firstSnapshot(
      <Box flexDirection="column">
        <Annotated name="visible" />
        <Box display="none">
          <Annotated name="hidden" />
        </Box>
      </Box>,
    );

    const names = snapshot.nodes.map((node) => node.name);
    expect(names).toContain('visible');
    expect(names).not.toContain('hidden');
  });

  it('does not publish plain layout boxes', async () => {
    const snapshot = await firstSnapshot(
      <Box flexDirection="column">
        <Box>
          <Box>
            <Annotated name="deep" />
          </Box>
        </Box>
      </Box>,
    );

    expect(snapshot.nodes.filter((node) => node.role === 'generic')).toHaveLength(0);
  });

  it('keeps the parent chain intact across unpublished boxes', async () => {
    const snapshot = await firstSnapshot(
      <Box flexDirection="column">
        <Box>
          <Annotated name="nested" />
        </Box>
      </Box>,
    );

    const button = snapshot.nodes.find((node) => node.name === 'nested');
    expect(button?.parentId).toBe(snapshot.rootIds[0]);
  });

  it('derives a name from rendered text when none was annotated', async () => {
    const snapshot = await firstSnapshot(
      <Box aria-role="listitem">
        <Text>first </Text>
        <Text>item</Text>
      </Box>,
    );

    expect(snapshot.nodes.find((node) => node.role === 'listitem')?.name).toBe('first item');
  });

  it('suppresses bounds when Static content moves the live region', async () => {
    const snapshot = await firstSnapshot(
      <Box flexDirection="column">
        <Static items={['one']}>{(item) => <Text key={item}>{item}</Text>}</Static>
        <Annotated name="visible" />
      </Box>,
    );

    expect(snapshot.nodes.every((node) => node.bounds === undefined)).toBe(true);
  });

  it('truncates names to the negotiated byte ceiling', async () => {
    const snapshot = await firstSnapshot(<Annotated name={'x'.repeat(500)} />, {
      limits: { ...DEFAULT_LIMITS, maxStringBytes: 16 },
    });

    const button = snapshot.nodes.find((node) => node.role === 'button');
    expect(button?.name).toHaveLength(16);
  });

  it('stops at the negotiated node ceiling instead of growing without bound', async () => {
    const snapshot = await firstSnapshot(
      <Box flexDirection="column">
        {Array.from({ length: 50 }, (_, index) => (
          <Annotated key={index} name={`item ${index}`} />
        ))}
      </Box>,
      { limits: { ...DEFAULT_LIMITS, maxNodes: 5 } },
    );

    expect(snapshot.nodes.length).toBeLessThanOrEqual(5);
  });
});
