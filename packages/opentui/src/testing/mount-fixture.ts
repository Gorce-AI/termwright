/**
 * The real `mountOpenTui` exercise, run under Bun.
 *
 * It lives in a script rather than in a `*.test.ts` because the suite runs on
 * Vitest under Node, and a mount cannot: `@opentui/core` needs `bun:ffi`.
 * `mount.test.ts` spawns this file with `bun` and asserts on the JSON it
 * prints, which keeps one test runner for the package while still exercising
 * the mount against a real renderer.
 *
 * Everything it checks is a claim `mountOpenTui` makes: the scene reaches a
 * headless terminal, semantic locators resolve against it with real viewport
 * coordinates, a click is a mouse report that the application handles on its
 * own, and `commit()` settles on the frame a mutation caused.
 *
 * Prints one JSON line to stdout: `{ ok: true, checks: {...} }`, or
 * `{ ok: false, error }`. Nothing else may go to stdout.
 */

import { writeSync } from 'node:fs';
import { BoxRenderable, TextRenderable } from '@opentui/core';
import { describeRenderable } from '../instrument.js';
import { mountOpenTui } from '../mount.js';

const report = (payload: unknown): void => {
  writeSync(1, `${JSON.stringify(payload)}\n`);
};

try {
  let clicks = 0;
  let status: TextRenderable | undefined;

  const harness = await mountOpenTui(
    (renderer) => {
      const button = new BoxRenderable(renderer, {
        id: 'approve',
        width: 13,
        height: 1,
        left: 2,
        top: 1,
        position: 'absolute',
      });
      button.add(new TextRenderable(renderer, { content: '[ Approve ]' }));
      button.onMouseDown = () => {
        clicks += 1;
        if (status !== undefined) status.content = `Approved ${String(clicks)}`;
        renderer.requestRender();
      };
      renderer.root.add(button);

      status = new TextRenderable(renderer, {
        id: 'status',
        content: 'Pending',
        left: 2,
        top: 3,
        position: 'absolute',
      });
      renderer.root.add(status);

      describeRenderable(button, { role: 'button', name: 'Approve', testId: 'approve' });
      describeRenderable(status, { role: 'status', testId: 'status' });
    },
    { columns: 40, rows: 10 },
  );

  const checks: Record<string, unknown> = {};

  try {
    checks['semanticTree'] = harness.capabilities().semanticTree;
    checks['adapter'] = harness.capabilities().adapter?.name;

    // Forwarded like every other harness member, and meaningful on a mount:
    // the adapter attaches after the renderer's first frames, so a caller that
    // waits for the verdict must get the settled one.
    const settled = await harness.settled();
    checks['settledSemanticTree'] = settled.semanticTree;
    checks['settledAdapter'] = settled.adapter?.name;

    const button = harness.getByRole('button', { name: 'Approve' });
    const resolved = await button.resolve();
    checks['buttonRef'] = typeof resolved.ref === 'string' && resolved.ref.length > 0;
    checks['semanticMatch'] = resolved.semantic;
    // Viewport-absolute, from screenX/screenY: the scene put the button at
    // column 2, row 1, and a mount is always an alternate-screen renderer.
    checks['rect'] = resolved.rect;

    // A click is a mouse report on stdin; nothing calls the handler directly.
    await button.click();
    await harness.waitForText('Approved 1');
    checks['clicksAfterClick'] = clicks;

    // A mutation made through commit() settles on the frame it caused.
    await harness.commit(() => {
      (status as TextRenderable).content = 'Committed';
    });
    checks['screenAfterCommit'] = harness.screen().text().includes('Committed');

    checks['statusText'] = await harness.getByTestId('status').textContent();
  } finally {
    await harness.close();
  }

  report({ ok: true, checks });
} catch (error) {
  report({ ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  process.exitCode = 1;
}
