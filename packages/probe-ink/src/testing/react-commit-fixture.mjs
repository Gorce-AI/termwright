import { PassThrough } from 'node:stream';
import { Socket } from 'node:net';
import { createElement } from 'react';

const mode = process.argv[2] ?? 'activate';
const bridgeModule = await import(new URL('../../dist/react-commit-bridge.js', import.meta.url));
const activationModule = await import(new URL('../../dist/react-reconciler-activation.js', import.meta.url));
const commits = [];
const rootIds = new WeakMap();
const lifecycle = [];
const firstHostRef = { current: null };
const secondHostRef = { current: null };
const refDiscoveredRoots = new WeakSet();
let nextRootId = 1;
let networkAttempts = 0;
const originalSocketConnect = Socket.prototype.connect;
Socket.prototype.connect = function () {
  networkAttempts += 1;
  throw new Error('network access is forbidden in the Ink reconciler activation fixture');
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (..._args) => {
  if (String(_args[0]).startsWith('data:')) return originalFetch(..._args);
  networkAttempts += 1;
  throw new Error('network access is forbidden in the Ink reconciler activation fixture');
};

const existingHookCalls = { inject: 0, commit: 0 };
const existingHook = {
  supportsFiber: true,
  inject(_renderer) {
    existingHookCalls.inject += 1;
    return 73;
  },
  onCommitFiberRoot() {
    existingHookCalls.commit += 1;
  },
  customCapability: 'preserved',
};
globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = existingHook;
const bridge = bridgeModule.installReactCommitBridge({
  onCommit({ rendererId, renderer, inkRoot: root }) {
    const snapshot = immutableSnapshot(root);
    let rootId = rootIds.get(root);
    if (rootId === undefined) {
      rootId = nextRootId++;
      rootIds.set(root, rootId);
    }
    if (firstHostRef.current?.parentNode !== undefined) {
      refDiscoveredRoots.add(firstHostRef.current.parentNode);
    }
    if (secondHostRef.current?.parentNode !== undefined) {
      refDiscoveredRoots.add(secondHostRef.current.parentNode);
    }
    commits.push({
      rendererId,
      rootId,
      packageName: renderer.rendererPackageName,
      version: renderer.version,
      nodeName: snapshot.nodeName,
      childCount: snapshot.childNodes.length,
      width: root.yogaNode?.getComputedWidth(),
      height: root.yogaNode?.getComputedHeight(),
      accessibility: accessibilityInventory(snapshot),
      matchesRefDiscoveredRoot: refDiscoveredRoots.has(root),
    });
    lifecycle.push(`commit:${rootId}`);
  },
});

const inkEntryUrl = import.meta.resolve('ink');
const { Box, Text, render } = await import('ink');
if (mode === 'activate') {
  const activation = await activationModule.activateInkReactInstrumentation(inkEntryUrl, bridge);
  if (!activation.injected) throw new Error('Ink reconciler activation did not inject');
} else if (mode !== 'none') {
  throw new Error(`unknown fixture mode: ${mode}`);
}

const output = () => {
  const stream = new PassThrough();
  const chunks = [];
  Object.defineProperties(stream, {
    columns: { configurable: true, value: 24 },
    rows: { configurable: true, value: 8 },
    isTTY: { configurable: true, value: true },
  });
  stream.on('data', chunk => {
    chunks.push(Buffer.from(chunk).toString('base64'));
    lifecycle.push('stdout');
  });
  stream.capturedChunks = chunks;
  return stream;
};

const accessibilityInventory = root => {
  const stack = [...root.childNodes];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node?.nodeName === '#text') continue;
    if (node?.internal_accessibility?.role !== undefined) {
      return {
        nodeName: node.nodeName,
        attributeKeys: node.attributeKeys,
        style: node.style,
        internalAccessibility: node.internal_accessibility,
        hasYogaNode: node.hasYogaNode === true,
        hasAriaLabelAttribute: node.attributeKeys.includes('aria-label'),
        hasAriaHiddenAttribute: node.attributeKeys.includes('aria-hidden'),
      };
    }
    stack.push(...node.childNodes);
  }
  return null;
};

const component = (label, ref) => createElement(
  Box,
  {
    ref,
    width: 12,
    borderStyle: 'single',
    'aria-role': 'button',
    'aria-label': `action-${label}`,
    'aria-hidden': false,
    'aria-state': { disabled: label === 'second' },
  },
  createElement(Text, null, label),
);

const firstOutput = output();
const secondOutput = output();
const first = render(component('first', firstHostRef), {
  stdout: firstOutput,
  patchConsole: false,
  maxFps: 1000,
  interactive: true,
  onRender: () => lifecycle.push('onRender:first'),
});
const second = render(component('other-root', secondHostRef), {
  stdout: secondOutput,
  patchConsole: false,
  maxFps: 1000,
  interactive: true,
  onRender: () => lifecycle.push('onRender:second'),
});
await Promise.all([first.waitUntilRenderFlush(), second.waitUntilRenderFlush()]);
lifecycle.push('flush:initial');
first.rerender(component('second', firstHostRef));
await first.waitUntilRenderFlush();
lifecycle.push('flush:rerender');

const rendererIds = commits.map(entry => entry.rendererId);
first.unmount();
second.unmount();
await Promise.all([first.waitUntilExit(), second.waitUntilExit()]);

process.stdout.write(`${JSON.stringify({
  runtime: globalThis.Bun === undefined ? 'node' : 'bun',
  rendererCount: bridge.inkRenderers.size,
  rootCount: nextRootId - 1,
  commits,
  rendererIds: [...new Set(rendererIds)],
  lifecycle,
  terminalOutput: [firstOutput.capturedChunks, secondOutput.capturedChunks],
  existingHookCalls,
  existingHookPreserved: bridge.hook.customCapability === 'preserved',
  networkAttempts,
  devtoolsCoreLoaded: performance.getEntriesByType('resource')
    .some(entry => entry.name.includes('react-devtools-core')),
})}\n`);

bridge.uninstall();
Socket.prototype.connect = originalSocketConnect;
globalThis.fetch = originalFetch;

function immutableSnapshot(value) {
  return deepFreeze({
    nodeName: value.nodeName,
    attributeKeys: Object.freeze(Object.keys(value.attributes ?? {})),
    style: snapshotData(value.style ?? {}),
    internal_accessibility: snapshotData(value.internal_accessibility ?? {}),
    hasYogaNode: value.yogaNode !== undefined,
    childNodes: value.childNodes.map(child => child.nodeName === '#text'
      ? { nodeName: '#text', nodeValue: child.nodeValue }
      : immutableSnapshot(child)),
  });
}

function snapshotData(value, seen = new WeakSet()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(child => snapshotData(child, seen));
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => typeof child !== 'function' && child !== undefined)
    .map(([key, child]) => [key, snapshotData(child, seen)]));
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
