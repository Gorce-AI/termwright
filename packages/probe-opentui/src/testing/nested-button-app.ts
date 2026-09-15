import { BoxRenderable, TextRenderable, createCliRenderer } from '@opentui/core';
import { describeRenderable } from '@termwright/opentui';

const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });
const button = new BoxRenderable(renderer, { id: 'nested-button', width: 24, height: 1 });
const child = new TextRenderable(renderer, {
  id: 'nested-button-label',
  content: 'Click nested button',
  width: 24,
  height: 1,
  ...(process.env['STOP_CHILD'] === '1' ? { onMouseDown: (event) => event.stopPropagation() } : {}),
});
const status = new TextRenderable(renderer, {
  id: 'nested-status',
  content: 'ready 0',
  width: 24,
  height: 1,
});
button.add(child);
button.onMouseDown = () => {
  status.content = 'parent clicked';
};
describeRenderable(button, {
  role: 'button',
  name: 'Nested',
  testId: 'nested-button',
  actions: ['activate'],
});
renderer.root.add(button);
renderer.root.add(status);
renderer.start();
// The preload can attach after the first static render on a cold host. Keep a
// small live status update so it always has a post-attachment frame to publish.
let heartbeat = 0;
const heartbeatTimer = setInterval(() => {
  heartbeat += 1;
  status.content = `ready ${heartbeat}`;
}, 100);
// A CLI renderer alone does not keep Bun alive on every host. The PTY closes
// this fixture as soon as its assertion completes; this is only a backstop for
// an interrupted test process.
setTimeout(() => {
  clearInterval(heartbeatTimer);
  renderer.destroy();
  process.exit(0);
}, 30_000);
