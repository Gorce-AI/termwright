/**
 * Semantic-session conformance — origin spec §20.2, driven by the Ink fixture.
 *
 * This is the suite that decides whether the semantic path is worth having:
 * strict locators, relationships, bounds, input hit-testing and paired
 * revisions. The fixture resolves clicks against its *own* measured layout, so
 * a hit-testing assertion here proves the driver aimed at the cell the
 * application believes the widget occupies — not merely that something moved.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AmbiguousLocatorError, TermwrightError } from '@termwright/driver';
import type { TerminalHarness } from '@termwright/driver';
import { CONFORMANCE_FIXTURES, createSessionPool, ptyAvailable, rejection } from '../support/pty.js';

const sessions = createSessionPool();

async function launch(): Promise<TerminalHarness> {
  const terminal = await sessions.launch(CONFORMANCE_FIXTURES.semanticInk(), {
    columns: 80,
    rows: 24,
    semanticNegotiationMs: 5_000,
  });
  await terminal.waitForText('Termwright Conformance');
  // Resolving waits for the first paired revision, so the tree is present.
  await terminal.getByTestId('status').resolve();
  return terminal;
}

afterEach(sessions.closeAll);

describe.skipIf(!ptyAvailable())('a semantic session', () => {
  it('negotiates the adapter and its capabilities', async () => {
    const terminal = await launch();
    const capabilities = terminal.capabilities();

    expect(capabilities.semanticTree).toBe(true);
    expect(capabilities.adapter?.name).toBe('@termwright/ink');
    expect(capabilities.capabilities).toContain('render-revisions');
    expect(capabilities.capabilities).toContain('absolute-bounds');
    expect(terminal.screen().buffer).toBe('alternate');
    expect(terminal.semanticTree()?.revision).toBeGreaterThanOrEqual(1);
  });

  it('fails strictly on duplicate names and disambiguates by scope', async () => {
    const terminal = await launch();

    expect(await terminal.getByRole('button', { name: 'Save' }).count()).toBe(2);
    const error = (await rejection(terminal.getByRole('button', { name: 'Save' }).resolve())) as TermwrightError;
    expect(error).toBeInstanceOf(AmbiguousLocatorError);
    expect(error.diagnostics.candidates).toHaveLength(2);
    expect(error.diagnostics.candidates?.map((candidate) => candidate.role)).toEqual(['button', 'button']);
    expect(error.diagnostics.suggestion).toContain('within()');

    const scoped = terminal.getByRole('button', { name: 'Save' }).within(terminal.getByTestId('sidebar'));
    expect((await scoped.resolve()).ref).toMatch(/^n\d+@\d+$/u);
    expect(await terminal.getByRole('button', { name: 'Save' }).first().isVisible()).toBe(true);
    expect((await terminal.getByRole('button', { name: 'Save' }).nth(1).resolve()).rect?.column).toBe(24);
  });

  it('walks relationships: nested regions, descendants and the CSS dialect', async () => {
    const terminal = await launch();

    // Filters is nested inside Sidebar; the descendant chain must hold.
    expect(await terminal.locator('region#sidebar region#filters button').count()).toBe(1);
    expect(await terminal.locator('region#content button').count()).toBe(1);
    expect(await terminal.locator('region#sidebar region#content button').count()).toBe(0);

    expect(await terminal.getByRole('listitem').count()).toBe(5);
    expect(await terminal.getByRole('listitem').within(terminal.getByRole('list', { name: 'Files' })).count()).toBe(5);
    expect(await terminal.getByLabel('Files').textContent()).toBe('Files');
    expect(await terminal.getByTestId('file-2').textContent()).toBe('ünïcode 日本語 😀');
  });

  it('publishes the state matrix the locators select on', async () => {
    const terminal = await launch();

    expect(await terminal.getByTestId('filter').semanticState()).toMatchObject({ focused: true });
    expect(await terminal.getByTestId('delete').semanticState()).toMatchObject({ disabled: true });
    expect(await terminal.getByTestId('filters').semanticState()).toMatchObject({ expanded: true });
    expect(await terminal.getByTestId('file-0').semanticState()).toMatchObject({
      selected: true,
      positionInSet: 1,
      setSize: 5,
    });
    expect(await terminal.getByTestId('list').semanticState()).toMatchObject({ orientation: 'vertical' });
    expect(await terminal.getByTestId('log').semanticState()).toMatchObject({ scrollOffset: 0, scrollExtent: 20 });
    expect(await terminal.locator('heading').semanticState()).toMatchObject({ level: 1 });
    expect(await terminal.locator('button:focused').count()).toBe(0);

    // Selecting on state is the point of publishing it.
    expect(await terminal.getByRole('listitem', { state: { selected: true } }).textContent()).toBe('readme.md');
    const disabled = await rejection(terminal.getByTestId('delete').click());
    expect((disabled as TermwrightError).code).toBe('unsupported-action');
    expect((disabled as TermwrightError).message).toContain('disabled');
  });

  it('publishes bounds the driver can aim at', async () => {
    const terminal = await launch();

    const save = await terminal.getByTestId('save-main').resolve();
    expect(save.semantic).toBe(true);
    expect(save.rect).toMatchObject({ row: 2, column: 24, height: 1 });

    // Every bound node must lie inside the viewport it was measured against.
    const snapshot = terminal.semanticTree();
    expect(snapshot).not.toBeNull();
    for (const node of snapshot?.nodes ?? []) {
      if (node.bounds === undefined) continue;
      expect(node.bounds.row).toBeGreaterThanOrEqual(0);
      expect(node.bounds.column).toBeGreaterThanOrEqual(0);
      expect(node.bounds.row).toBeLessThan(snapshot?.rows ?? 0);
      expect(node.bounds.column).toBeLessThan(snapshot?.columns ?? 0);
    }
  });

  it('hits the widget the bounds point at, and misses when it should', async () => {
    const terminal = await launch();

    await terminal.getByTestId('save-main').click();
    await terminal.waitForText('last: CLICK save-main');

    await terminal.getByTestId('file-3').click();
    await terminal.waitForText('last: CLICK file-3');
    // The marker that commits the tree follows the frame, so the tree catches
    // up a beat after the text does.
    await expect
      .poll(async () => (await terminal.getByTestId('file-3').semanticState())?.selected)
      .toBe(true);

    await terminal.getByTestId('save-sidebar').doubleClick();
    await terminal.waitForText('last: DBLCLICK save-sidebar');

    // Below the application's own bounds nothing is hit — the fixture says so
    // itself rather than the test inferring it.
    await terminal.getByTestId('status').click({ position: { rowOffset: 6, columnOffset: 60 } });
    await terminal.waitForText('last: CLICK outside');
  });

  it('drives the textbox and reflects its value in the tree', async () => {
    const terminal = await launch();

    await terminal.getByTestId('filter').type('abc');
    await expect.poll(async () => (await terminal.getByTestId('filter').textContent())).toBe('abc');
    await terminal.waitForText('Filter: abc_');

    const node = terminal.semanticTree()?.nodes.find((entry) => entry.testId === 'filter');
    expect(node?.role).toBe('textbox');
    expect(node?.name).toBe('Filter');
    expect(node?.value).toBe('abc');
  });

  it('publishes a modal dialog and takes it away again', async () => {
    const terminal = await launch();
    expect(await terminal.getByRole('dialog').count()).toBe(0);

    await terminal.press('Tab'); // leave the textbox, so `d` is a command
    await terminal.press('d');
    await terminal.getByRole('dialog').waitFor();

    expect(await terminal.getByRole('dialog').semanticState()).toMatchObject({ modal: true });
    expect(await terminal.locator('dialog button:focused').textContent()).toBe('Approve');
    const receipt = await terminal.locator('dialog button:focused').activate();
    expect(receipt.strategy).toBe('focus-enter');
    await terminal.waitForText('last: ACTIVATED dialog-approve');

    await terminal.getByRole('dialog').waitFor({ state: 'hidden' });
    expect(await terminal.getByRole('dialog').count()).toBe(0);
  });

  it('binds refs to the revision they were taken at', async () => {
    const terminal = await launch();

    const before = await terminal.getByTestId('save-main').resolve();
    await terminal.press('Tab');
    await expect.poll(() => terminal.semanticTree()?.revision ?? 0).toBeGreaterThan(before.revision);
    const after = await terminal.getByTestId('save-main').resolve();

    // Same node, later revision: the id survives a rerender, the ref does not.
    expect(after.ref.split('@')[0]).toBe(before.ref.split('@')[0]);
    expect(after.ref).not.toBe(before.ref);
    expect(after.revision).toBeGreaterThan(before.revision);

    // A node that a rerender removed stops resolving instead of resolving stale.
    await terminal.press('d');
    await terminal.getByRole('dialog').waitFor();
    const dialogRef = await terminal.getByTestId('dialog-approve').resolve();
    await terminal.press('Escape');
    await expect.poll(() => terminal.getByTestId('dialog-approve').count()).toBe(0);
    const gone = (await rejection(terminal.getByTestId('dialog-approve').resolve({ timeout: 400 }))) as TermwrightError;
    expect(gone.code).toBe('timeout');

    // Rebuilt from the ref, the same disappearance is a stale snapshot rather
    // than a locator that matched nothing — the ref names a specific node at a
    // specific revision, so the driver can tell "gone" from "never there".
    const stale = (await rejection(terminal.locatorForRef(dialogRef.ref).resolve({ timeout: 400 }))) as TermwrightError;
    expect(stale.code).toBe('stale-snapshot');
  });

  it('rebuilds a locator from a ref by identity, not by name', async () => {
    const terminal = await launch();

    // Two buttons are called 'Save'; a ref has to survive that.
    const sidebar = await terminal
      .getByRole('button', { name: 'Save' })
      .within(terminal.getByTestId('sidebar'))
      .resolve();
    const rebuilt = terminal.locatorForRef(sidebar.ref);

    expect((await rebuilt.resolve()).ref).toBe(sidebar.ref);
    expect(await rebuilt.textContent()).toBe('Save');
    expect((await rebuilt.boundingBox())?.column).toBe(0);
    expect(rebuilt.description).toContain(sidebar.ref.split('@')[0] ?? '');

    // The other 'Save' is a different node, and its ref says so.
    const content = await terminal.getByTestId('save-main').resolve();
    expect(content.ref).not.toBe(sidebar.ref);
    expect((await terminal.locatorForRef(content.ref).boundingBox())?.column).toBe(24);

    // A ref taken from a grid match works the same way. `occurrence` forces
    // grid matching even here, where a semantic tree is available.
    const grid = await terminal.getByText('log line 1', { occurrence: 1 }).resolve();
    expect(grid.ref).toMatch(/^grid:/u);
    expect(await terminal.locatorForRef(grid.ref).textContent()).toContain('log line 1');
  });

  it('pairs every published tree with the frame it describes', async () => {
    const terminal = await launch();
    const revisions: number[] = [];
    terminal.events.on('semantic-revision', ({ revision }) => revisions.push(revision));

    // Four rerenders back to back: the pairing must not publish a tree that
    // describes a frame the terminal has not drawn yet.
    for (let press = 0; press < 4; press += 1) await terminal.press('Tab');
    await terminal.waitForStable();

    const snapshot = terminal.semanticTree();
    expect(snapshot).not.toBeNull();
    expect(revisions).not.toHaveLength(0);
    expect([...revisions]).toEqual([...revisions].sort((left, right) => left - right));

    const focused = snapshot?.nodes.find((node) => node.role === 'button' && node.state?.focused === true);
    const screen = terminal.screen().text();
    if (focused !== undefined) {
      // The tree says a button is focused; the frame it was paired with must
      // be the one that draws it as focused.
      expect(screen).toContain('[Save]');
    }
    const status = snapshot?.nodes.find((node) => node.testId === 'status');
    expect(screen).toContain(`last: ${status?.name ?? ''}`);
  });

  it('leaves the alternate screen and stops publishing when the app unmounts', async () => {
    const terminal = await launch();
    expect(terminal.screen().buffer).toBe('alternate');

    await terminal.press('Tab');
    await terminal.press('q');
    const status = await terminal.waitForExit();

    expect(status.code).toBe(0);
    expect(terminal.screen().buffer).toBe('normal');
  });
});
