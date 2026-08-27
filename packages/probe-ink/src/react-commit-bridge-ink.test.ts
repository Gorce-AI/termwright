import { PassThrough } from 'node:stream';
import { createElement } from 'react';
import { Box, render, Text } from 'ink';
import { describe, expect, it } from 'vitest';
import {
  activateInkRendererObservation,
  correlateInkHostProps,
  type InkCommitEvent,
  type InkReconcilerInstrumentation,
} from './react-commit-bridge.js';

describe('Ink React renderer instrumentation seam', () => {
  it('exposes the real committed Ink host root through FiberRoot.containerInfo', async () => {
    const holder = globalThis as typeof globalThis & {
      __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
    };
    const previous = Object.getOwnPropertyDescriptor(holder, '__REACT_DEVTOOLS_GLOBAL_HOOK__');
    delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const inkEntry = import.meta.resolve('ink');
    const reconcilerUrl = inkEntry.replace(/index\.js$/u, 'reconciler.js');
    const reconciler = (
      (await import(reconcilerUrl)) as {
        readonly default: InkReconcilerInstrumentation;
      }
    ).default;
    const bridge = activateInkRendererObservation(reconciler);
    const commits: Extract<InkCommitEvent, { type: 'commit' }>[] = [];
    const unmounts: Extract<InkCommitEvent, { type: 'unmount' }>[] = [];
    const release = bridge.subscribe((event) => {
      if (event.type === 'commit') commits.push(event);
      if (event.type === 'unmount') unmounts.push(event);
    });
    const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
    Object.defineProperties(stdout, {
      columns: { value: 20 },
      rows: { value: 8 },
      isTTY: { value: true },
    });
    const instance = render(
      createElement(
        Box,
        {
          'aria-label': 'Observed action',
          'aria-hidden': true,
          'aria-role': 'button',
          'aria-state': { disabled: true, selected: false },
        },
        createElement(Text, null, 'observed'),
      ),
      {
        stdout,
        patchConsole: false,
      },
    );

    try {
      await instance.waitUntilRenderFlush();
      expect(commits.length).toBeGreaterThan(0);
      expect(commits.at(-1)?.root.nodeName).toBe('ink-root');
      expect(commits.at(-1)?.fiberRoot.containerInfo).toBe(commits.at(-1)?.root);
      expect(commits.at(-1)?.root.childNodes.length).toBeGreaterThan(0);
      const latest = commits.at(-1)!;
      const box = latest.root.childNodes.find((node) => node.nodeName === 'ink-box');
      expect(box?.nodeName).toBe('ink-box');
      if (box?.nodeName !== 'ink-box') throw new Error('Ink did not commit the expected host box');
      // Normal-mode Ink DOM preserves role/state but deliberately drops the
      // original label/hidden props. The Fiber POC can correlate them through
      // stateNode without traversing Fiber for host hierarchy.
      expect(box.internal_accessibility).toEqual({
        role: 'button',
        state: { disabled: true, selected: false },
      });
      const correlation = correlateInkHostProps(latest.fiberRoot).get(box);
      expect(correlation).toEqual(
        expect.objectContaining({
          accessibleName: 'Observed action',
          ariaHidden: true,
          sourceProps: expect.objectContaining({
            'aria-role': 'button',
            'aria-state': { disabled: true, selected: false },
          }),
        }),
      );
      instance.unmount();
      await instance.waitUntilExit();
      expect(unmounts.length).toBeGreaterThan(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      release();
      if (previous === undefined) delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      else Object.defineProperty(holder, '__REACT_DEVTOOLS_GLOBAL_HOOK__', previous);
    }
  });
});
