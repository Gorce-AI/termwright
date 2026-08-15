/**
 * The conformance fixture: a real OpenTUI application, in its own process,
 * driven through a real pseudo-terminal.
 *
 * It runs against the **built** package, so the suite exercises what a user
 * installs. It runs under `bun`, because `@opentui/core` 0.5.3 loads its
 * native library through `bun:ffi` and Node has no equivalent yet (NOTES.md).
 *
 * Protocol with the suite:
 *   - prints `Ready` in a labelled button on the first frame;
 *   - `Tab` writes `Committed <n>` on a status line, with `n` rising on every
 *     press;
 *   - `q` exits with status 0.
 *
 * The status line is a *separate*, initially blank renderable on purpose.
 * OpenTUI repaints only the cells that changed, so relabelling `Ready` to
 * `[Save]` in place emits `[S` and `ve]` as two runs — around the unchanged
 * `a` — and the whole word never appears contiguously in the byte stream the
 * suite matches against. Writing into blank cells emits one run. The counter
 * is what makes a second press produce output too, which is how the suite
 * proves the application is still alive after the channel is cut.
 *
 * `--plain` skips instrumentation entirely, which is the baseline the dormant
 * rule is compared against.
 */

import {
  BoxRenderable,
  createCliRenderer,
  TextRenderable,
  type CliRenderer,
} from '@opentui/core';
// Deliberately the build output: the fixture must fail if `dist/` is stale.
import { describeRenderable, instrumentRenderer } from '../../dist/index.js';

const plain = process.argv.includes('--plain');

const renderer: CliRenderer = await createCliRenderer({
  screenMode: 'alternate-screen',
  exitOnCtrlC: false,
  consoleMode: 'disabled',
  useMouse: false,
});

if (!plain) instrumentRenderer(renderer);

const button = new BoxRenderable(renderer, {
  id: 'action',
  width: 12,
  height: 1,
  left: 2,
  top: 1,
  position: 'absolute',
});
const label = new TextRenderable(renderer, { id: 'action-label', content: 'Ready' });
button.add(label);
renderer.root.add(button);

const status = new TextRenderable(renderer, {
  id: 'status',
  content: '',
  left: 2,
  top: 3,
  position: 'absolute',
});
renderer.root.add(status);

if (!plain) {
  describeRenderable(button, { role: 'button', name: 'Ready', testId: 'action' });
  describeRenderable(status, { role: 'status', testId: 'status' });
}

let commits = 0;

renderer.keyInput.on('keypress', (key) => {
  if (key.name === 'tab') {
    commits += 1;
    status.content = `Committed ${String(commits)}`;
    renderer.requestRender();
    return;
  }
  if (key.name === 'q') {
    renderer.destroy();
    process.stdout.write('', () => {
      process.exit(0);
    });
  }
});
