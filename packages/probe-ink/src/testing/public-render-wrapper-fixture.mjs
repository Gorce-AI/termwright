import { PassThrough } from 'node:stream';
import { createElement } from 'react';

const bridgeModule = await import(new URL('../../dist/react-commit-bridge.js', import.meta.url));
const activationModule = await import(new URL('../../dist/react-reconciler-activation.js', import.meta.url));
const wrapperModule = await import(new URL('../../dist/public-render-wrapper-poc.js', import.meta.url));

const events = [];
let sequence = 0;
const event = (kind, root, detail) => events.push({ sequence: ++sequence, kind, root, detail });
const roots = new WeakMap();
const rootIds = new Set();
let nextRoot = 1;
const bridge = bridgeModule.installReactCommitBridge({
  onCommit({ inkRoot }) {
    let root = roots.get(inkRoot);
    if (root === undefined) {
      root = nextRoot++;
      roots.set(inkRoot, root);
      rootIds.add(root);
    }
    event('commit', root, textOf(inkRoot));
  },
});

const inkEntry = import.meta.resolve('ink');
const ink = await import('ink');
await activationModule.activateInkReactInstrumentation(inkEntry, bridge);

const observerCallbacks = { first: 0, second: 0 };
const userCallbacks = { first: 0, second: 0 };
const stream = name => {
  const output = new PassThrough();
  Object.defineProperties(output, {
    columns: { value: 30 },
    rows: { value: 8 },
    isTTY: { value: true },
  });
  output.on('data', () => event('stdout', name));
  return output;
};
const firstOutput = stream('first');
const secondOutput = stream('second');
const receiver = { render: ink.render };
const rawInstances = [];
const observedOriginal = function (...args) {
  const instance = Reflect.apply(receiver.render, this, args);
  rawInstances.push(instance);
  return instance;
};
const firstWrapped = wrapperModule.wrapPublicInkRender(observedOriginal, {
  onRender() {
    observerCallbacks.first += 1;
    event('observer-onRender', 'first');
  },
});
const secondWrapped = wrapperModule.wrapPublicInkRender(observedOriginal, {
  onRender() {
    observerCallbacks.second += 1;
    event('observer-onRender', 'second');
  },
});

const view = label => createElement(ink.Box, null, createElement(ink.Text, null, label));
const firstOptions = Object.freeze({
  stdout: firstOutput,
  patchConsole: false,
  interactive: false,
  maxFps: 30,
  onRender() {
    userCallbacks.first += 1;
    event('user-onRender', 'first');
  },
});
const secondOptions = Object.freeze({
  stdout: secondOutput,
  patchConsole: false,
  interactive: false,
  maxFps: 30,
  onRender() {
    userCallbacks.second += 1;
    event('user-onRender', 'second');
  },
});

const first = Reflect.apply(firstWrapped, receiver, [view('initial-first'), firstOptions]);
const second = Reflect.apply(secondWrapped, receiver, [view('initial-second'), secondOptions]);
const returnIdentity = {
  first: first === rawInstances[0],
  second: second === rawInstances[1],
};
await Promise.all([first.waitUntilRenderFlush(), second.waitUntilRenderFlush()]);
event('flush', 'initial');

first.rerender(view('rapid-1'));
first.rerender(view('rapid-2'));
first.rerender(view('rapid-3'));
await first.waitUntilRenderFlush();
event('flush', 'rapid');

first.unmount();
second.unmount();
await Promise.all([first.waitUntilExit(), second.waitUntilExit()]);
event('flush', 'exit');

const order = kind => events.filter(entry => entry.kind === kind).map(entry => entry.sequence);
const userAfterObserver = ['first', 'second'].every(name => {
  const observers = events.filter(entry => entry.kind === 'observer-onRender' && entry.root === name);
  const users = events.filter(entry => entry.kind === 'user-onRender' && entry.root === name);
  return users.every((entry, index) => (observers[index]?.sequence ?? Number.POSITIVE_INFINITY) < entry.sequence);
});
const flushAfterOnRender = Math.min(...order('flush')) > Math.min(...order('user-onRender'));
const at = (kind, root, detail) => events.find(entry =>
  entry.kind === kind && entry.root === root && (detail === undefined || entry.detail === detail),
)?.sequence ?? Number.POSITIVE_INFINITY;
const initialOnRenderBeforeCommit = at('user-onRender', 'first') < at('commit', 1, 'initial-first')
  && at('user-onRender', 'second') < at('commit', 2, 'initial-second');
const rapidCommitEntries = events.filter(entry => entry.kind === 'commit' && String(entry.detail).startsWith('rapid-'));
const rapidOnRender = events.find(entry => entry.kind === 'user-onRender' && entry.root === 'first'
  && entry.sequence > at('flush', 'initial'))?.sequence ?? Number.NEGATIVE_INFINITY;
const rapidCommitsBeforeOnRender = rapidCommitEntries.length === 3
  && rapidCommitEntries.every(entry => entry.sequence < rapidOnRender);
const unmountOnRenderBeforeCommit = events
  .filter(entry => entry.kind === 'commit' && entry.detail === '')
  .every(entry => events.some(candidate => candidate.kind === 'user-onRender'
    && candidate.sequence < entry.sequence
    && candidate.sequence > at('flush', 'rapid')));
const stdoutAfterUnmountCommit = ['first', 'second'].every((name, index) =>
  at('commit', index + 1, '') < at('stdout', name),
);
const unmountedRoots = [...rootIds].filter(root => events.some(
  entry => entry.kind === 'commit' && entry.root === root && entry.detail === '',
));

process.stdout.write(`${JSON.stringify({
  rootCount: nextRoot - 1,
  returnIdentity,
  observerCallbacks,
  userCallbacks,
  userAfterObserver,
  flushAfterOnRender,
  initialOnRenderBeforeCommit,
  rapidCommitsBeforeOnRender,
  unmountOnRenderBeforeCommit,
  stdoutAfterUnmountCommit,
  customStreams: [...new Set(events.filter(entry => entry.kind === 'stdout').map(entry => entry.root))],
  rapidLabels: events.filter(entry => entry.kind === 'commit' && String(entry.detail).startsWith('rapid-')).map(entry => entry.detail),
  unmountedRoots,
  events,
})}\n`);

bridge.uninstall();

function textOf(root) {
  const values = [];
  const visit = node => {
    if (node?.nodeName === '#text') values.push(node.nodeValue);
    else for (const child of node?.childNodes ?? []) visit(child);
  };
  visit(root);
  return values.join('');
}
