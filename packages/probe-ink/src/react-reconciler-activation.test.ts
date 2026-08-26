import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateInkReactInstrumentation,
  INK_REACT_INSTRUMENTATION_UNAVAILABLE,
  reconcilerUrlFromPublicEntry,
} from './react-reconciler-activation.js';
import { REACT_DEVTOOLS_HOOK } from './react-commit-bridge.js';
import { installReactCommitBridge } from './react-commit-bridge.js';

const globals = globalThis as typeof globalThis & Record<string, unknown>;
const originalHook = globals[REACT_DEVTOOLS_HOOK];

afterEach(() => {
  if (originalHook === undefined) delete globals[REACT_DEVTOOLS_HOOK];
  else globals[REACT_DEVTOOLS_HOOK] = originalHook;
});

describe('Ink reconciler activation', () => {
  it('resolves the reconciler next to the loader-resolved public entry', () => {
    expect(reconcilerUrlFromPublicEntry(
      'file:///workspace/node_modules/ink/build/index.js?termwright-original=1',
    )).toBe('file:///workspace/node_modules/ink/build/reconciler.js');
  });

  it('calls the existing reconciler capability without reading or transforming source', async () => {
    const bridge = installReactCommitBridge({ onCommit: vi.fn() });
    const injectIntoDevTools = vi.fn(function (this: unknown): boolean {
      void this;
      bridge.hook.inject?.({ rendererPackageName: 'ink' });
      return false;
    });
    const importer = vi.fn(async () => ({ default: { injectIntoDevTools } }));
    const result = await activateInkReactInstrumentation(
      'file:///candidate/ink/build/index.js',
      bridge,
      importer,
    );
    expect(importer).toHaveBeenCalledWith('file:///candidate/ink/build/reconciler.js');
    expect(injectIntoDevTools).toHaveBeenCalledOnce();
    expect(result).toEqual({
      reconcilerUrl: 'file:///candidate/ink/build/reconciler.js',
      injected: true,
      rendererIds: [1],
    });
    bridge.uninstall();
  });

  it.each([
    ['missing hook', undefined, { default: { injectIntoDevTools: (): boolean => true } }],
    ['missing method', { supportsFiber: true, inject: () => 1 }, { default: {} }],
    ['rejected hook', { supportsFiber: true, inject: () => 1 }, { default: { injectIntoDevTools: (): boolean => false } }],
  ])('fails closed for %s', async (_name, hook, module) => {
    globals[REACT_DEVTOOLS_HOOK] = hook;
    const bridge = installReactCommitBridge({ onCommit: vi.fn() });
    await expect(activateInkReactInstrumentation(
      'file:///candidate/ink/build/index.js',
      bridge,
      async () => module,
    )).rejects.toThrow(INK_REACT_INSTRUMENTATION_UNAVAILABLE);
    bridge.uninstall();
  });

  it('fails closed when the private sibling cannot be loaded', async () => {
    const bridge = installReactCommitBridge({ onCommit: vi.fn() });
    await expect(activateInkReactInstrumentation(
      'file:///candidate/ink/build/index.js',
      bridge,
      async () => { throw new Error('missing'); },
    )).rejects.toThrow('could not load reconciler sibling');
    bridge.uninstall();
  });

  it('does not mistake a foreign renderer registration for Ink activation', async () => {
    const bridge = installReactCommitBridge({ onCommit: vi.fn() });
    await expect(activateInkReactInstrumentation(
      'file:///candidate/ink/build/index.js',
      bridge,
      async () => ({
        default: {
          injectIntoDevTools() {
            bridge.hook.inject?.({ rendererPackageName: 'react-dom' });
            return false;
          },
        },
      }),
    )).rejects.toThrow('did not register a renderer');
    expect(bridge.inkRenderers.size).toBe(0);
    bridge.uninstall();
  });
});
