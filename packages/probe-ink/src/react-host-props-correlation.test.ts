import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  correlateInkHostProps,
  INK_HOST_PROPS_CORRELATION_DIAGNOSTIC,
  type ReactFiberLike,
} from './react-host-props-correlation.js';

const execFileAsync = promisify(execFile);

describe('experimental React host-props correlation', () => {
  it('maps an exact host stateNode without depending on Fiber tags', () => {
    const host = { nodeName: 'ink-box' as const, childNodes: [] };
    const root = { nodeName: 'ink-root' as const, style: {}, childNodes: [host] };
    const props = { 'aria-label': 'direct-host' };
    expect(correlateInkHostProps({ current: { stateNode: host, memoizedProps: props } }, root).get(host))
      .toBe(props);
  });

  it('fails closed for a missing, duplicate, or incomplete host correlation', () => {
    const host = { nodeName: 'ink-box' as const, childNodes: [] };
    const root = { nodeName: 'ink-root' as const, style: {}, childNodes: [host] };
    expect(() => correlateInkHostProps({}, root)).toThrow(INK_HOST_PROPS_CORRELATION_DIAGNOSTIC);
    expect(() => correlateInkHostProps({ current: {} }, root)).toThrow(
      INK_HOST_PROPS_CORRELATION_DIAGNOSTIC,
    );

    const duplicate: ReactFiberLike = {
      stateNode: host,
      memoizedProps: {},
      sibling: { stateNode: host, memoizedProps: {} },
    };
    expect(() => correlateInkHostProps({ current: duplicate }, root)).toThrow(
      INK_HOST_PROPS_CORRELATION_DIAGNOSTIC,
    );
    expect(() => correlateInkHostProps({
      current: { stateNode: host, memoizedProps: 'not-props' },
    }, root)).toThrow(INK_HOST_PROPS_CORRELATION_DIAGNOSTIC);

    const cyclic = {} as { sibling?: ReactFiberLike };
    cyclic.sibling = cyclic;
    expect(() => correlateInkHostProps({ current: cyclic }, root)).toThrow(
      INK_HOST_PROPS_CORRELATION_DIAGNOSTIC,
    );
  });

  it.each([
    ['Node', process.execPath],
    ['Bun', 'bun'],
  ])('proves consumed aria props lack a direct host correlation under %s', async (
    _runtime,
    executable,
  ) => {
    const result = await runFixture(executable);
    expect(result.rootCount).toBe(2);
    expect(result.commits.length).toBeGreaterThanOrEqual(5);
    const liveCommits = result.commits.filter((commit) => commit.hosts.length > 0);
    expect(liveCommits.every((commit) => commit.hosts.every(
      (host) => host.label === undefined && host.hidden === undefined,
    ))).toBe(true);
    expect(result.commits.filter((commit) => commit.rootId === 1).map((commit) => commit.ariaFibers))
      .toEqual([
        [{ label: 'action-first', hidden: false, hasStateNode: false }],
        [{ label: 'action-second', hidden: true, hasStateNode: false }],
        [],
      ]);
    expect(result.commits.filter((commit) => commit.rootId === 2).map((commit) => commit.ariaFibers))
      .toEqual([
        [{ label: 'action-other-root', hidden: false, hasStateNode: false }],
        [],
      ]);
    expect(result.failures).toEqual([]);
  });
});

interface FixtureResult {
  readonly rootCount: number;
  readonly failures: readonly string[];
  readonly commits: ReadonlyArray<{
    readonly rootId: number;
    readonly hosts: ReadonlyArray<{
      readonly nodeName: string;
      readonly label?: unknown;
      readonly hidden?: unknown;
    }>;
    readonly ariaFibers: ReadonlyArray<{
      readonly label: unknown;
      readonly hidden: unknown;
      readonly hasStateNode: boolean;
    }>;
  }>;
}

async function runFixture(executable: string): Promise<FixtureResult> {
  const fixture = new URL('./testing/react-host-props-correlation-fixture.mjs', import.meta.url);
  const { stdout } = await execFileAsync(executable, [fileURLToPath(fixture)], {
    cwd: process.cwd(),
    env: { ...process.env, DEV: 'false', CI: 'true', FORCE_COLOR: '0' },
  });
  return JSON.parse(stdout.trim()) as FixtureResult;
}
