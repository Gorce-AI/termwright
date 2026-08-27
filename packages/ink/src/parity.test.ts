/**
 * The claim that makes two modes acceptable instead of confusing: the same
 * component, driven the same way, is described the same way.
 *
 * Both harnesses render `counter-app.mjs` — literally the same file, not two
 * transcriptions of it — at the same size, and the trees are compared node by
 * node. Whatever differs here is a difference test authors would otherwise hit
 * by surprise when moving a test between modes.
 */

import { afterEach, expect } from 'vitest';
import {it as resourceAwareIt} from '@termwright/resource-broker/vitest';
import { createElement } from 'react';
import type { Rect, SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import type { SemanticLocator, TerminalHarness } from '@termwright/driver';
import { launchInkFixture } from './fixture.js';
import { mountInk } from './mount.js';
import CounterApp from './testing/counter-app.mjs';

const COMPONENT = new URL('./testing/counter-app.mjs', import.meta.url);
const SIZE = { columns: 44, rows: 14 } as const;
const PROPS = { label: 'Approve', greeting: 'parity' } as const;
// Each parity case keeps the in-process mount and the real PTY fixture alive
// together while comparing them. Reserve the complete atomic live group.
const it = resourceAwareIt.resources({terminals: 2, traceWriters: 0});

const open: TerminalHarness[] = [];

async function intendedRect(locator: SemanticLocator): Promise<Rect | null> {
  const observation = (await locator.geometry()).intendedRect;
  return observation.status === 'known' ? observation.value : null;
}

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
    intendedRect: node.geometry.intendedRect.status === 'known' ? node.geometry.intendedRect.value : null,
    visibleRect: node.geometry.visibleRect.status === 'known' ? node.geometry.visibleRect.value : null,
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
  expect(fixture.contract()?.capabilities).toEqual(mounted.contract()?.capabilities);
  expect(fixture.screen().text()).toBe(mounted.screen().text());
});

it('answers the same locator, and the same terminal activation, in both modes', async () => {
  const mounted = await mountInk(createElement(CounterApp, PROPS), SIZE);
  open.push(mounted);
  const fixture = await launchInkFixture({ component: COMPONENT, props: PROPS, ...SIZE });
  open.push(fixture);

  const box = await intendedRect(mounted.getByRole('button', { name: 'Approve' }));
  expect(await intendedRect(fixture.getByRole('button', { name: 'Approve' }))).toEqual(box);

  await mounted.press('Enter');
  await fixture.press('Enter');
  await mounted.waitForText('pressed 1');
  await fixture.waitForText('pressed 1');

  expect(fixture.screen().text()).toBe(mounted.screen().text());
});
