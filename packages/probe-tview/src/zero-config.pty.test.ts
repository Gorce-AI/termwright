/**
 * The whole path, walked once: a plain tview application, built through the
 * generated workspace, launched under the real driver, addressed by role.
 *
 * Everything else in this package proves a piece — the copy compiles, the
 * canary confirms which copy compiled, the probe survives a stalled driver.
 * This is the test that says a user's application, with no imports of ours and
 * no configuration, becomes addressable.
 *
 * Skipped without a Go toolchain or a pseudo-terminal.
 */

import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { createNodePtyBackend, launchTerminal, type Locator, type TerminalHarness } from '@termwright/driver';
import type { Rect } from '@termwright/protocol';
import {
  applyPatchSet,
  canaryCheck,
  ensureUpstreamModule,
  materializeUpstream,
  writeWorkspace,
} from '@termwright/probe-go';
import { prepareInstrumentedBuild } from './launch.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const PATCH_SET = join(here, '..', 'upstream-patches', 'tview', 'v0.42.0');
const FIXTURE = join(here, 'testing', 'fixture-app');
const FIXTURE_ANNOTATED = join(here, 'testing', 'fixture-annotated');
const CLIENT = join(here, '..', '..', '..', 'clients', 'go');

async function intendedRect(locator: Locator): Promise<Rect | null> {
  const observation = (await locator.geometry()).intendedRect;
  return observation.status === 'known' ? observation.value : null;
}

async function goAvailable(): Promise<boolean> {
  if (process.env['TERMWRIGHT_SKIP_GO'] === '1') return false;
  try {
    await run('go', ['version']);
    return true;
  } catch {
    return false;
  }
}

function ptyAvailable(): boolean {
  if (process.env['TERMWRIGHT_SKIP_PTY'] === '1') return false;
  try {
    const pty = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', 'process.exit(0)'],
      env: { PATH: process.env['PATH'] ?? '' },
      columns: 20,
      rows: 4,
    });
    pty.dispose();
    return true;
  } catch {
    return false;
  }
}

const runnable = (await goAvailable()) && ptyAvailable();
const roots: string[] = [];
const sessions: TerminalHarness[] = [];

afterAll(async () => {
  await Promise.all(sessions.map((session) => session.close()));
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Builds the fixture, optionally through the instrumented copy. */
async function buildFixture(options: { readonly instrumented: boolean }): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-zeroconfig-')));
  roots.push(dir);

  const app = join(dir, 'app');
  await mkdir(app, { recursive: true });
  await cp(FIXTURE, app, { recursive: true });

  const binary = join(dir, 'app-binary');
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (options.instrumented) {
    const copy = join(dir, 'tview');
    await materializeUpstream(
      await ensureUpstreamModule({
        module: 'github.com/rivo/tview',
        version: 'v0.42.0',
        cachePath: ['github.com', 'rivo', 'tview@v0.42.0'],
      }),
      copy,
    );
    await applyPatchSet(copy, PATCH_SET);

    env['GOWORK'] = await writeWorkspace(join(dir, 'generated.work'), {
      moduleDir: app,
      inherited: { uses: [], replaces: [] },
      suppliedUses: [
        { dir: await realpath(CLIENT), module: 'github.com/gorce-ai/termwright/clients/go' },
      ],
      replaces: [
        { from: 'github.com/rivo/tview', to: copy },
        {
          from: 'github.com/gorce-ai/termwright/clients/go',
          to: await realpath(CLIENT),
          version: 'v0.0.0',
        },
      ],
    });
  } else {
    // The comparison arm: the same source, the untouched framework.
    env['GOFLAGS'] = '-mod=mod';
  }

  await run('go', ['build', '-o', binary, '.'], { cwd: app, env });
  return binary;
}

describe.skipIf(!runnable)('developer annotations', () => {
  it('adds what the probe cannot observe, and nothing it can', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-annotated-')));
    roots.push(dir);
    const app = join(dir, 'app');
    await mkdir(app, { recursive: true });
    await cp(FIXTURE_ANNOTATED, app, { recursive: true });

    const copy = join(dir, 'tview');
    await materializeUpstream(
      await ensureUpstreamModule({
        module: 'github.com/rivo/tview',
        version: 'v0.42.0',
        cachePath: ['github.com', 'rivo', 'tview@v0.42.0'],
      }),
      copy,
    );
    await applyPatchSet(copy, PATCH_SET);

    const client = await realpath(join(here, '..', '..', '..', 'clients', 'go'));
    const workspace = await writeWorkspace(join(dir, 'generated.work'), {
      moduleDir: app,
      inherited: { uses: [], replaces: [] },
      suppliedUses: [
        { dir: client, module: 'github.com/gorce-ai/termwright/clients/go' },
      ],
      replaces: [
        { from: 'github.com/rivo/tview', to: copy },
        {
          from: 'github.com/gorce-ai/termwright/clients/go',
          to: client,
          version: 'v0.0.0',
        },
      ],
    });

    const binary = join(dir, 'app-binary');
    await run('go', ['build', '-o', binary, '.'], {
      cwd: app,
      env: { ...process.env, GOWORK: workspace },
    });

    const session = await launchTerminal({ command: [binary], columns: 80, rows: 24 });
    sessions.push(session);
    await session.waitForText('unread');

    // A widget the probe has never heard of: without the annotation it would
    // be a generic region named after its Go type. The annotation says what it
    // is, and the probe's own facts stay underneath.
    await expect.poll(() => session.getByTestId('unread-badge').count()).toBe(1);
    await expect
      .poll(() => session.getByRole('status', { name: 'Unread messages' }).count())
      .toBe(1);

    // Domain state the closed vocabulary has no room for, reported verbatim.
    await expect
      .poll(() => session.getByTestId('unread-badge').extendedState())
      .toEqual({ mailbox: 'inbox', unread: 3 });

    // Merge, not replacement: the annotation sharpened the button's name while
    // its role and its measured geometry came from the probe.
    await expect
      .poll(() => session.getByRole('button', { name: 'Save changes' }).count())
      .toBe(1);
    const box = await intendedRect(session.getByRole('button', { name: 'Save changes' }));
    expect(box?.width).toBeGreaterThan(0);
    const tree = session.semanticTree();
    const saveNode = tree?.nodes.find((node) => node.testId === 'save');
    const labelNode = tree?.nodes.find(
      (node) => node.role === 'text' && node.name === 'Save changes',
    );
    const helpNode = tree?.nodes.find((node) => node.name === 'Writes the current file');
    expect(saveNode?.actions).toEqual(['focus', 'activate']);
    expect(saveNode?.labelledBy).toEqual([labelNode?.id]);
    expect(saveNode?.describedBy).toEqual([helpNode?.id]);
    expect(saveNode?.p).toBe('framework');
    expect(saveNode?.px).toEqual(
      expect.objectContaining({
        role: 'recognizer',
        name: 'annotation',
        actions: 'annotation',
        labelledBy: 'annotation',
        describedBy: 'annotation',
      }),
    );

    // Interaction still works through the annotated handle.
    await session.press('Tab');
    await expect
      .poll(async () => (await session.getByTestId('save').semanticState())?.focused)
      .toBe(true);
  }, 900_000);
});

describe.skipIf(!runnable)('the launcher call', () => {
  it('prepares a build from one call, and caches the copy for the next', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-launch-')));
    roots.push(dir);
    const app = join(dir, 'app');
    await mkdir(app, { recursive: true });
    await cp(FIXTURE, app, { recursive: true });

    // A cache of its own, so the assertion about building versus reusing is
    // about this test rather than about whatever ran before it.
    const env = { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') };

    const first = await prepareInstrumentedBuild({ moduleDir: app, env });
    expect(first.built).toBe(true);
    // The version was detected from the module, not passed in.
    expect(first.copyDir).toContain('v0.42.0');

    await run('go', ['build', '-o', join(dir, 'bin'), '.'], { cwd: app, env: first.env });

    const second = await prepareInstrumentedBuild({ moduleDir: app, env });
    expect(second.built).toBe(false);
    expect(second.copyDir).toBe(first.copyDir);

    // And the canary still proves it is our copy that compiles.
    const canary = await canaryCheck({
      copyDir: second.copyDir,
      moduleDir: app,
      workspaceFile: second.workspaceFile,
      packageName: 'tview',
      env,
    });
    expect(canary.proved).toBe(true);
  }, 600_000);

  it('refuses a vendored build by name instead of overriding it', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-launch-')));
    roots.push(dir);
    const app = join(dir, 'app');
    await mkdir(app, { recursive: true });
    await cp(FIXTURE, app, { recursive: true });

    await expect(
      prepareInstrumentedBuild({ moduleDir: app, env: { ...process.env, GOFLAGS: '-mod=vendor' } }),
    ).rejects.toThrow(/-mod=vendor/u);
  }, 120_000);

  it('does not illegally replace the client when the app is inside that module', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-launch-client-')));
    roots.push(dir);
    const prepared = await prepareInstrumentedBuild({
      moduleDir: CLIENT,
      workspaceFile: join(dir, 'generated.work'),
      env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') },
    });

    const workspace = await readFile(prepared.workspaceFile, 'utf8');
    expect(workspace).not.toMatch(/replace github\.com\/gorce-ai\/termwright\/clients\/go/u);
    await run('go', ['build', '-o', join(dir, 'permission'), './examples/permission'], {
      cwd: CLIENT,
      env: prepared.env,
    });
  }, 600_000);
});

describe.skipIf(!runnable)('a plain tview application under the probe', () => {
	it('publishes qualified geometry without claiming pointer ownership', async () => {
		const binary = await buildFixture({ instrumented: true });
		const app = await launchTerminal({
			command: [binary],
			columns: 80,
			rows: 24,
		});
		sessions.push(app);
		await app.waitForText('readme.md');
		await expect.poll(() => app.semanticTree()?.v).toBe(2);

		const tree = app.semanticTree();
		expect(tree?.hitGrid).toEqual({
			status: 'unsupported',
			capability: 'pointer-hit-grid',
			reason: 'framework-unobservable',
		});
		const list = tree?.nodes.find((node) => node.role === 'list' && node.name === 'Files');
		expect(list?.geometry?.displayed).toMatchObject({ status: 'known', value: true });
		expect(list?.geometry?.intendedRect).toMatchObject({ status: 'known' });
		expect(list?.geometry?.visibleRect).toMatchObject({ status: 'known' });
		expect(list?.bounds).toBeUndefined();
	}, 600_000);

  it('exposes its widgets by role, with no import and no configuration', async () => {
    const binary = await buildFixture({ instrumented: true });

    const app = await launchTerminal({ command: [binary], columns: 80, rows: 24 });
    sessions.push(app);
    await app.waitForText('readme.md');

    // The claim of the whole phase: semantics from an application that was
    // never told about us.
    expect(app.capabilities().semanticTree).toBe(true);
    expect(app.capabilities().adapter?.name).toBe('termwright-probe-tview');
    expect(app.capabilities().probe).toEqual({
      framework: 'tview',
      frameworkVersion: 'v0.42.0',
      probeVersion: '0.1.0',
      identityKind: 'stable',
      capabilities: ['stable-identity', 'annotations'],
    });

    // The driver's own API rather than the Vitest preset's matchers: a probe
    // package should not depend on the test preset to prove it works.
    await expect.poll(() => app.getByRole('list', { name: 'Files' }).count()).toBe(1);
    await expect.poll(() => app.getByRole('listitem', { name: 'readme.md' }).count()).toBe(1);
    await expect.poll(() => app.getByRole('button', { name: 'Save' }).count()).toBe(1);

    // A widget on a page tview has not shown carries `hidden` rather than
    // being absent — the in-package walk is what makes that knowable.
    await expect
      .poll(async () => (await app.getByRole('textbox', { name: 'Name' }).visibility()).displayed)
      .toMatchObject({ status: 'known', value: false });

    // Showing the page flips exactly that: the widget stops being hidden.
    // Not asserted on the screen, because tview draws the shown page over the
    // status line rather than beside it — the tree knows, the grid does not.
    await app.press('s');
    await expect.poll(() => app.getByRole('textbox', { name: 'Name' }).count()).toBe(1);
    await expect.poll(() => app.getByRole('region', { name: 'Settings' }).count()).toBe(1);
  }, 600_000);

  it('reflects focus, selection, value and resize in the tree', async () => {
    // The rest of the C list. Each of these is a fact the driver can only get
    // from the probe: the screen shows a highlight, the tree says which widget
    // holds the focus and which row is selected.
    const binary = await buildFixture({ instrumented: true });
    const app = await launchTerminal({ command: [binary], columns: 80, rows: 24 });
    sessions.push(app);
    await app.waitForText('readme.md');

    const state = async (role: 'list' | 'button' | 'listitem' | 'textbox', name: string) =>
      app.getByRole(role, { name }).semanticState();

    // focus: it starts on the list and Tab moves it to the button.
    await expect.poll(async () => (await state('list', 'Files'))?.focused).toBe(true);
    await app.press('Tab');
    await expect.poll(async () => (await state('button', 'Save'))?.focused).toBe(true);
    await expect.poll(async () => (await state('list', 'Files'))?.focused).not.toBe(true);

    // selection: moving through the list changes which item is selected, and
    // the tree names it rather than leaving a highlight to be read off cells.
    await app.press('Tab Tab');
    await expect.poll(async () => (await state('listitem', 'readme.md'))?.selected).toBe(true);
    await app.press('ArrowDown');
    await expect.poll(async () => (await state('listitem', 'main.go'))?.selected).toBe(true);
    await expect.poll(async () => (await state('listitem', 'readme.md'))?.selected).not.toBe(true);

    // value: typing into the field on the settings page.
    await app.press('s');
    await expect.poll(() => app.getByRole('textbox', { name: 'Name' }).count()).toBe(1);
    await app.type('release');
    await expect.poll(() => app.getByRole('textbox', { name: 'Name' }).textContent()).toContain(
      'release',
    );

    // resize: a real SIGWINCH, and geometry that follows it.
    const before = await intendedRect(app.getByRole('list', { name: 'Files' }));
    await app.resize({ columns: 50, rows: 18 });
    await expect
      .poll(async () => (await intendedRect(app.getByRole('list', { name: 'Files' })))?.width)
      .toBe(50);
    expect(before?.width).toBe(80);
  }, 600_000);

  it('renders byte-identically to the untouched framework when not instrumented', async () => {
    // The dormancy claim, measured rather than asserted from the source: the
    // instrumented binary run without the handshake variables must paint what
    // the vanilla one paints.
    const [vanilla, instrumented] = await Promise.all([
      buildFixture({ instrumented: false }),
      buildFixture({ instrumented: true }),
    ]);

    const screens: string[] = [];
    for (const binary of [vanilla, instrumented]) {
      // envMode 'replace' already withholds the handshake variables, so the
      // instrumented binary has no driver to talk to even though one launched
      // it. That is exactly the dormant case.
      const session = await launchTerminal({
        command: [binary],
        columns: 80,
        rows: 24,
        env: { TERMWRIGHT_ENDPOINT: '', TERMWRIGHT_TOKEN: '' },
      });
      sessions.push(session);
      await session.waitForText('readme.md');
      await session.waitForStable();
      screens.push(session.screen().text());
    }

    expect(screens[1]).toBe(screens[0]);
  }, 900_000);
});

describe.skipIf(runnable)('the zero-config arms', () => {
  it('skips because no Go toolchain or no pseudo-terminal is reachable', () => {
    expect(runnable).toBe(false);
  });
});

/** Kept for the failure message when the fixture stops being zero-config. */
it('the fixture imports nothing of ours', async () => {
  const source = await readFile(join(FIXTURE, 'main.go'), 'utf8');
  const imports = source.slice(source.indexOf('import ('), source.indexOf(')'));

  expect(imports).not.toContain('termwright');
  expect(imports).toContain('github.com/rivo/tview');
});
