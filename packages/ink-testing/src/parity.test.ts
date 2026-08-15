/**
 * The claim that makes two modes acceptable instead of confusing: the same
 * component, driven the same way, is described the same way.
 *
 * Both harnesses render `counter-app.mjs` — literally the same file, not two
 * transcriptions of it — at the same size, and the trees are compared node by
 * node. Whatever differs here is a difference test authors would otherwise hit
 * by surprise when moving a test between modes.
 */

import { afterEach, expect, it } from 'vitest';
import { createElement } from 'react';
import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import type { TerminalHarness } from '@termwright/driver';
import { launchInkFixture } from './fixture.js';
import { mountInk } from './mount.js';
import CounterApp from './testing/counter-app.mjs';

const COMPONENT = new URL('./testing/counter-app.mjs', import.meta.url);
const SIZE = { columns: 44, rows: 14 } as const;
const PROPS = { label: 'Approve', greeting: 'parity' } as const;

const open: TerminalHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

/** Everything about a node that a test can assert on, minus its identity. */
function shape(snapshot: SemanticSnapshot): unknown[] {
  return snapshot.nodes.map((node: SemanticNode) => ({
    role: node.role,
    name: node.name,
    value: node.value ?? null,
    state: node.state ?? null,
    bounds: node.bounds ?? null,
    testId: node.testId ?? null,
  }));
}

it('describes the same component identically in-process and in a pty', async () => {
  const mounted = await mountInk(createElement(CounterApp, PROPS), SIZE);
  open.push(mounted);
  const fixture = await launchInkFixture({ component: COMPONENT, props: PROPS, ...SIZE });
  open.push(fixture);

  const mountedTree = mounted.semanticTree();
  const fixtureTree = fixture.semanticTree();
  expect(mountedTree).not.toBeNull();
  expect(fixtureTree).not.toBeNull();

  // Node identity and revision numbers are per-session by definition; the
  // description of the interface is not.
  expect(shape(fixtureTree as SemanticSnapshot)).toEqual(shape(mountedTree as SemanticSnapshot));
  expect({ columns: fixtureTree?.columns, rows: fixtureTree?.rows }).toEqual({
    columns: mountedTree?.columns,
    rows: mountedTree?.rows,
  });
  expect(fixture.capabilities().capabilities).toEqual(mounted.capabilities().capabilities);
  expect(fixture.screen().text()).toBe(mounted.screen().text());
});

it('answers the same locator, and the same click, in both modes', async () => {
  const mounted = await mountInk(createElement(CounterApp, PROPS), SIZE);
  open.push(mounted);
  const fixture = await launchInkFixture({ component: COMPONENT, props: PROPS, ...SIZE });
  open.push(fixture);

  const box = await mounted.getByRole('button', { name: 'Approve' }).boundingBox();
  expect(await fixture.getByRole('button', { name: 'Approve' }).boundingBox()).toEqual(box);

  await mounted.getByRole('button', { name: 'Approve' }).click();
  await fixture.getByRole('button', { name: 'Approve' }).click();
  await mounted.waitForText('pressed 1');
  await fixture.waitForText('pressed 1');

  expect(fixture.screen().text()).toBe(mounted.screen().text());
});
