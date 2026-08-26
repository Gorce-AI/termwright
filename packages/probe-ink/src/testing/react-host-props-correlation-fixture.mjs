import { PassThrough } from 'node:stream';
import { createElement } from 'react';

const bridgeModule = await import(new URL('../../dist/react-commit-bridge.js', import.meta.url));
const activationModule = await import(new URL('../../dist/react-reconciler-activation.js', import.meta.url));
const correlationModule = await import(
  new URL('../../dist/react-host-props-correlation.js', import.meta.url)
);

const commits = [];
const failures = [];
const rootIds = new WeakMap();
let nextRootId = 1;
const bridge = bridgeModule.installReactCommitBridge({
  onCommit({ fiberRoot, inkRoot }) {
    let rootId = rootIds.get(inkRoot);
    if (rootId === undefined) {
      rootId = nextRootId++;
      rootIds.set(inkRoot, rootId);
    }
    try {
      const propsByHost = correlationModule.correlateInkHostProps(fiberRoot, inkRoot);
      commits.push({
        rootId,
        hosts: [...propsByHost].map(([host, props]) => ({
          nodeName: host.nodeName,
          label: props['aria-label'],
          hidden: props['aria-hidden'],
        })),
        ariaFibers: inspectAriaFibers(fiberRoot.current),
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  },
});

const inkEntryUrl = import.meta.resolve('ink');
const { Box, Text, render } = await import('ink');
await activationModule.activateInkReactInstrumentation(inkEntryUrl, bridge);

const output = () => {
  const stream = new PassThrough();
  Object.defineProperties(stream, {
    columns: { configurable: true, value: 24 },
    rows: { configurable: true, value: 8 },
    isTTY: { configurable: true, value: true },
  });
  stream.resume();
  return stream;
};

const Action = ({ label, hidden }) => createElement(
  Box,
  {
    width: 12,
    'aria-role': 'button',
    'aria-label': `action-${label}`,
    'aria-hidden': hidden,
  },
  createElement(Text, null, label),
);

const first = render(createElement(Action, { label: 'first', hidden: false }), {
  stdout: output(),
  patchConsole: false,
  maxFps: 1000,
});
const second = render(createElement(Action, { label: 'other-root', hidden: false }), {
  stdout: output(),
  patchConsole: false,
  maxFps: 1000,
});
await Promise.all([first.waitUntilRenderFlush(), second.waitUntilRenderFlush()]);
first.rerender(createElement(Action, { label: 'second', hidden: true }));
await first.waitUntilRenderFlush();
first.unmount();
second.unmount();
await Promise.all([first.waitUntilExit(), second.waitUntilExit()]);

process.stdout.write(`${JSON.stringify({
  rootCount: nextRootId - 1,
  commits,
  failures,
})}\n`);
bridge.uninstall();

function inspectAriaFibers(current) {
  const found = [];
  const stack = current === undefined || current === null ? [] : [current];
  const visited = new Set();
  while (stack.length > 0) {
    const fiber = stack.pop();
    if (visited.has(fiber)) throw new Error('Fiber cycle');
    visited.add(fiber);
    const props = fiber.memoizedProps;
    if (props !== null && typeof props === 'object'
      && ('aria-label' in props || 'aria-hidden' in props)) {
      found.push({
        label: props['aria-label'],
        hidden: props['aria-hidden'],
        hasStateNode: fiber.stateNode !== null && fiber.stateNode !== undefined,
      });
    }
    if (fiber.sibling !== undefined && fiber.sibling !== null) stack.push(fiber.sibling);
    if (fiber.child !== undefined && fiber.child !== null) stack.push(fiber.child);
  }
  return found;
}
