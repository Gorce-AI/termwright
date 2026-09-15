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
  content: 'idle',
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
