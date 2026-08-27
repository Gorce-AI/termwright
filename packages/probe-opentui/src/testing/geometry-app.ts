/** Adversarial real-renderer fixture for the certified OpenTUI runtime observer. */
import { BoxRenderable, TextRenderable, createCliRenderer } from '@opentui/core';

const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });

const outer = new BoxRenderable(renderer, {
  id: 'outer-clip', width: 12, height: 5, overflow: 'hidden', position: 'absolute', left: 2, top: 1,
});
const inner = new BoxRenderable(renderer, {
  id: 'inner-clip', width: 9, height: 3, overflow: 'hidden', position: 'absolute', left: 5, top: 1,
});
const clipped = new TextRenderable(renderer, {
  id: 'nested-clipped', content: 'nested clipped target', width: 20, height: 1,
});
inner.add(clipped);
outer.add(inner);

const lower = new TextRenderable(renderer, {
  id: 'lower-overlap', content: 'lower overlap', width: 8, height: 1,
  position: 'absolute', left: 20, top: 2, zIndex: 1,
});
const upper = new TextRenderable(renderer, {
  id: 'upper-overlap', content: 'upper overlap', width: 8, height: 1,
  position: 'absolute', left: 20, top: 2, zIndex: 2,
});
const hidden = new TextRenderable(renderer, {
  id: 'hidden-node', content: 'hidden node', width: 8, height: 1,
  position: 'absolute', left: 1, top: 8, visible: false,
});
const movedByHook = new TextRenderable(renderer, {
  id: 'hook-moved', content: 'hook moved', width: 8, height: 1,
  position: 'absolute', left: 1, top: 10,
  renderBefore() {
    // Adversarial custom hook: OpenTUI itself samples _screenX after this hook
    // for native hit ownership. The instrumentation must sample at that same
    // boundary rather than reuse the earlier retained-tree walk.
    (this as unknown as { _screenX: number })._screenX += 3;
  },
});

renderer.root.add(outer);
renderer.root.add(lower);
renderer.root.add(upper);
renderer.root.add(hidden);
renderer.root.add(movedByHook);
renderer.start();

let input = '';
let destroyed = false;

const destroy = (code: number): void => {
  if (destroyed) return;
  destroyed = true;
  renderer.destroy();
  process.stdout.write('', () => process.exit(code));
};

const command = (line: string): void => {
  switch (line) {
    case 'resize':
      renderer.resize(40, 12);
      return;
    case 'destroy':
      destroy(0);
      return;
    default:
      process.stderr.write(`unknown geometry fixture command: ${JSON.stringify(line)}\n`);
      destroy(1);
  }
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  input += chunk;
  for (;;) {
    const newline = input.indexOf('\n');
    if (newline < 0) return;
    const line = input.slice(0, newline).trim();
    input = input.slice(newline + 1);
    if (line !== '') command(line);
  }
});
process.stdin.on('end', () => {
  if (!destroyed) {
    process.stderr.write('geometry fixture control input ended before destroy\n');
    destroy(1);
  }
});
process.stdin.resume();
