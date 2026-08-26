import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  installReactCommitBridge,
  REACT_DEVTOOLS_HOOK,
  type ReactRendererMetadata,
} from './react-commit-bridge.js';

const execFileAsync = promisify(execFile);

describe('ReactCommitBridge', () => {
  it('composes with an existing hook and ignores foreign renderers', () => {
    const calls: string[] = [];
    const existing = {
      supportsFiber: true,
      customField: 'preserved',
      inject(renderer: ReactRendererMetadata) {
        calls.push(`inject:${renderer.rendererPackageName}`);
        return renderer.rendererPackageName === 'ink' ? 41 : 42;
      },
      onCommitFiberRoot(rendererId: number) {
        calls.push(`commit:${rendererId}`);
      },
      onCommitFiberUnmount(rendererId: number) {
        calls.push(`unmount:${rendererId}`);
      },
    };
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    const prior = globals[REACT_DEVTOOLS_HOOK];
    globals[REACT_DEVTOOLS_HOOK] = existing;
    const observed = vi.fn();
    const unmounted = vi.fn();
    const bridge = installReactCommitBridge({ onCommit: observed, onUnmount: unmounted });

    try {
      expect((bridge.hook as unknown as { customField: string }).customField).toBe('preserved');
      const inkId = bridge.hook.inject?.({ rendererPackageName: 'ink', version: '7.1.1' });
      const foreignId = bridge.hook.inject?.({ rendererPackageName: 'react-dom', version: '19.2.0' });
      const inkRoot = { nodeName: 'ink-root', style: {}, childNodes: [] };
      bridge.hook.onCommitFiberRoot?.(inkId as number, { containerInfo: inkRoot });
      bridge.hook.onCommitFiberRoot?.(foreignId as number, { containerInfo: {} });
      bridge.hook.onCommitFiberUnmount?.(inkId as number, {});
      bridge.hook.onCommitFiberUnmount?.(foreignId as number, {});

      expect(observed).toHaveBeenCalledOnce();
      expect(observed.mock.calls[0]?.[0]).toMatchObject({ rendererId: 41, inkRoot });
      expect(unmounted).toHaveBeenCalledWith(41, {});
      expect(calls).toEqual([
        'inject:ink',
        'inject:react-dom',
        'commit:41',
        'commit:42',
        'unmount:41',
        'unmount:42',
      ]);
    } finally {
      bridge.uninstall();
      if (prior === undefined) delete globals[REACT_DEVTOOLS_HOOK];
      else globals[REACT_DEVTOOLS_HOOK] = prior;
    }
  });

  it('stops observation, clears renderer state, and restores the prior hook on uninstall', () => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    const prior = globals[REACT_DEVTOOLS_HOOK];
    delete globals[REACT_DEVTOOLS_HOOK];
    const observed = vi.fn();
    const bridge = installReactCommitBridge({ onCommit: observed });
    const retainedHook = bridge.hook;
    const rendererId = retainedHook.inject?.({ rendererPackageName: 'ink' }) as number;

    bridge.uninstall();
    retainedHook.onCommitFiberRoot?.(rendererId, {
      containerInfo: { nodeName: 'ink-root', style: {}, childNodes: [] },
    });

    expect(observed).not.toHaveBeenCalled();
    expect(bridge.inkRenderers.size).toBe(0);
    expect(globals[REACT_DEVTOOLS_HOOK]).toBeUndefined();
    bridge.uninstall();
    if (prior === undefined) delete globals[REACT_DEVTOOLS_HOOK];
    else globals[REACT_DEVTOOLS_HOOK] = prior;
  });

  it('delegates unknown hook methods and accessors with the existing hook as receiver', () => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    const prior = globals[REACT_DEVTOOLS_HOOK];
    interface StatefulHook {
      counter: number;
      readonly currentCounter: number;
      setStrictMode(rendererId: number, enabled: boolean): void;
      onScheduleFiberRoot(): void;
      onPostCommitFiberRoot(): void;
      customState?: string;
    }
    const extension = Symbol('existing-hook-extension');
    const existing: StatefulHook = {
      counter: 0,
      get currentCounter() {
        expect(this).toBe(existing);
        return this.counter;
      },
      setStrictMode(this: StatefulHook, _rendererId: number, enabled: boolean) {
        expect(this).toBe(existing);
        if (enabled) this.counter += 1;
      },
      onScheduleFiberRoot(this: StatefulHook) {
        expect(this).toBe(existing);
        this.counter += 1;
      },
      onPostCommitFiberRoot(this: StatefulHook) {
        expect(this).toBe(existing);
        this.counter += 1;
      },
    };
    Object.defineProperty(existing, 'nonEnumerableState', {
      configurable: true,
      value: 'retained',
    });
    Object.defineProperty(existing, extension, {
      configurable: true,
      enumerable: true,
      value: 'symbol-retained',
    });
    globals[REACT_DEVTOOLS_HOOK] = existing;
    const bridge = installReactCommitBridge({ onCommit: vi.fn() });
    const delegated = bridge.hook as unknown as {
      readonly currentCounter: number;
      setStrictMode(rendererId: number, enabled: boolean): void;
      onScheduleFiberRoot(rendererId: number, root: unknown): void;
      onPostCommitFiberRoot(rendererId: number, root: unknown): void;
      customState?: string;
    };
    try {
      const firstDelegate = delegated.setStrictMode;
      expect(delegated.setStrictMode).toBe(firstDelegate);
      firstDelegate(1, true);
      delegated.onScheduleFiberRoot(1, {});
      delegated.onPostCommitFiberRoot(1, {});
      delegated.customState = 'preserved';
      expect(delegated.currentCounter).toBe(3);
      expect(existing.customState).toBe('preserved');
      expect(Object.keys(bridge.hook)).toContain('counter');
      expect(Object.hasOwn(bridge.hook, 'nonEnumerableState')).toBe(true);
      expect(Reflect.ownKeys(bridge.hook)).toContain(extension);
      expect((bridge.hook as Record<PropertyKey, unknown>)[extension]).toBe('symbol-retained');

      const retained = bridge.hook as unknown as typeof delegated;
      bridge.uninstall();
      retained.onScheduleFiberRoot(1, {});
      expect(existing.counter).toBe(4);
    } finally {
      bridge.uninstall();
      if (prior === undefined) delete globals[REACT_DEVTOOLS_HOOK];
      else globals[REACT_DEVTOOLS_HOOK] = prior;
    }
  });

  it.each([undefined, null, 0, -1, 1.5, '1'])('fails closed on delegated renderer ID %j', (id) => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    const prior = globals[REACT_DEVTOOLS_HOOK];
    globals[REACT_DEVTOOLS_HOOK] = { inject: () => id };
    const bridge = installReactCommitBridge({ onCommit: vi.fn() });
    try {
      expect(() => bridge.hook.inject?.({ rendererPackageName: 'ink' })).toThrow(
        'existing hook returned an invalid renderer ID',
      );
      expect(bridge.inkRenderers.size).toBe(0);
    } finally {
      bridge.uninstall();
      if (prior === undefined) delete globals[REACT_DEVTOOLS_HOOK];
      else globals[REACT_DEVTOOLS_HOOK] = prior;
    }
  });

  it('observes real Ink roots through FiberRoot.containerInfo with explicit activation', async () => {
    const enabled = await runFixture(process.execPath, 'activate');
    const disabled = await runFixture(process.execPath, 'none');

    expect(enabled.rendererCount).toBe(1);
    expect(enabled.rootCount).toBe(2);
    expect(enabled.rendererIds).toEqual([73]);
    expect(enabled.commits.length).toBeGreaterThanOrEqual(5);
    expect(enabled.commits.every((commit) => commit.packageName === 'ink')).toBe(true);
    expect(enabled.commits.every((commit) => typeof commit.version === 'string')).toBe(true);
    expect(enabled.commits.every((commit) => commit.nodeName === 'ink-root')).toBe(true);
    expect(enabled.commits.some((commit) => commit.width === 24)).toBe(true);
    expect(new Set(enabled.commits.map((commit) => commit.rootId))).toEqual(new Set([1, 2]));
    expect(enabled.commits.every((commit) => commit.matchesRefDiscoveredRoot)).toBe(true);
    expect(enabled.commits.some((commit) => (
      commit.accessibility?.internalAccessibility as { role?: string } | undefined
    )?.role === 'button')).toBe(true);
    expect(enabled.commits.some((commit) => commit.accessibility?.hasYogaNode === true)).toBe(true);
    expect(enabled.commits[0]?.accessibility?.internalAccessibility).toMatchObject({
      state: { disabled: false },
    });
    expect(enabled.commits.some((commit) => (
      commit.accessibility?.internalAccessibility as { state?: { disabled?: boolean } } | undefined
    )?.state?.disabled === true)).toBe(true);
    expect(enabled.commits.filter((commit) => commit.accessibility !== null).every(
      (commit) => commit.accessibility?.hasAriaLabelAttribute === false,
    )).toBe(true);
    expect(enabled.commits.filter((commit) => commit.accessibility !== null).every(
      (commit) => commit.accessibility?.hasAriaHiddenAttribute === false,
    )).toBe(true);
    expect(enabled.existingHookCalls.inject).toBe(1);
    expect(enabled.existingHookCalls.commit).toBe(enabled.commits.length);
    for (const rootId of [1, 2]) {
      expect(enabled.commits.filter((commit) => commit.rootId === rootId).at(-1)?.childCount).toBe(0);
    }
    expect(enabled.existingHookPreserved).toBe(true);
    expect(enabled.networkAttempts).toBe(0);
    expect(enabled.devtoolsCoreLoaded).toBe(false);

    expect(disabled.rendererCount).toBe(0);
    expect(disabled.commits).toEqual([]);
    expect(enabled.terminalOutput).toEqual(disabled.terminalOutput);
    expect(enabled.processStderr).toBe(disabled.processStderr);
  });

  it('activates the same bridge and reconciler capability under Bun', async () => {
    const result = await runFixture('bun', 'activate');
    const disabled = await runFixture('bun', 'none');
    expect(result.runtime).toBe('bun');
    expect(result.rendererCount).toBe(1);
    expect(result.rootCount).toBe(2);
    expect(result.rendererIds).toEqual([73]);
    expect(result.commits.length).toBeGreaterThanOrEqual(5);
    expect(result.networkAttempts).toBe(0);
    expect(result.devtoolsCoreLoaded).toBe(false);
    expect(result.terminalOutput).toEqual(disabled.terminalOutput);
    expect(result.processStderr).toBe(disabled.processStderr);
  });
});

interface FixtureResult {
  readonly rendererCount: number;
  readonly rootCount: number;
  readonly rendererIds: readonly number[];
  readonly runtime: 'node' | 'bun';
  readonly networkAttempts: number;
  readonly devtoolsCoreLoaded: boolean;
  readonly existingHookCalls: { readonly inject: number; readonly commit: number };
  readonly existingHookPreserved: boolean;
  readonly commits: ReadonlyArray<{
    readonly packageName?: string;
    readonly version?: string;
    readonly rootId: number;
    readonly matchesRefDiscoveredRoot: boolean;
    readonly nodeName?: string;
    readonly childCount: number;
    readonly width?: number;
    readonly accessibility: null | {
      readonly internalAccessibility?: unknown;
      readonly hasYogaNode: boolean;
      readonly hasAriaLabelAttribute: boolean;
      readonly hasAriaHiddenAttribute: boolean;
    };
  }>;
  readonly terminalOutput: readonly (readonly string[])[];
  readonly processStderr: string;
}

async function runFixture(executable: string, mode: 'activate' | 'none'): Promise<FixtureResult> {
  const fixture = new URL('./testing/react-commit-fixture.mjs', import.meta.url);
  const { stdout, stderr } = await execFileAsync(
    executable,
    [fileURLToPath(fixture), mode],
    {
      cwd: process.cwd(),
      env: { ...process.env, DEV: 'false', CI: 'true', FORCE_COLOR: '0' },
    },
  );
  return { ...JSON.parse(stdout.trim()) as FixtureResult, processStderr: stderr };
}
