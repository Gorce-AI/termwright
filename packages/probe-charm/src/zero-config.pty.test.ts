/**
 * The zero-config path for Charm, and the claim it has to earn: semantics
 * meaningfully richer than reading the grid.
 *
 * Bubble Tea gives no widget tree and no geometry, so "richer" cannot mean
 * bounds here. It means the things a screen scrape cannot recover — which
 * component a piece of text belongs to, what a field actually contains, and
 * which one has the focus.
 */

import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createNodePtyBackend, launchTerminal, type TerminalHarness } from '@termwright/driver';
import {
  applyPatchSet,
  ensureUpstreamModule,
  materializeUpstream,
  writeWorkspace,
} from '@termwright/probe-go';
import { afterAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'testing', 'fixture-v2');
const PATCH_SET = join(here, '..', 'upstream-patches', 'bubbletea', 'v2.0.8');
const CLIENT = join(here, '..', '..', '..', 'clients', 'go');

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

async function buildFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-zc-')));
  roots.push(dir);

  const app = join(dir, 'app');
  await mkdir(app, { recursive: true });
  await cp(FIXTURE, app, { recursive: true });

  const copy = join(dir, 'bubbletea');
  await materializeUpstream(
    await ensureUpstreamModule({
      module: 'charm.land/bubbletea/v2',
      version: 'v2.0.8',
      cachePath: ['charm.land', 'bubbletea', 'v2@v2.0.8'],
    }),
    copy,
  );
  await applyPatchSet(copy, PATCH_SET);

  const workspace = await writeWorkspace(join(dir, 'generated.work'), {
    moduleDir: app,
    inherited: { uses: [], replaces: [] },
    replaces: [
      { from: 'charm.land/bubbletea/v2', to: copy },
      { from: 'github.com/gorce-ai/termwright/clients/go', to: await realpath(CLIENT) },
    ],
  });

  const binary = join(dir, 'app-binary');
  await run('go', ['build', '-o', binary, '.'], {
    cwd: app,
    env: { ...process.env, GOWORK: workspace },
  });
  return binary;
}

describe.skipIf(!runnable)('a plain Bubble Tea application under the probe', () => {
  it('names the components the screen only shows as text', async () => {
    const binary = await buildFixture();
    const app = await launchTerminal({ command: [binary], columns: 80, rows: 12 });
    sessions.push(app);
    await app.waitForText('Sign in');

    expect(app.capabilities().semanticTree).toBe(true);
    expect(app.capabilities().adapter?.name).toBe('termwright-probe-charm');

    // The claim: a grid scrape sees two rows of similar-looking text. The tree
    // says which component each is, and which one is focused — neither of
    // which is recoverable from cells.
    await expect
      .poll(async () => (await app.getByRole('textbox', { name: 'Name' }).semanticState())?.focused)
      .toBe(true);
    await expect.poll(() => app.getByRole('textbox', { name: 'Password' }).isVisible()).toBe(true);

    await app.type('ada');
    await expect.poll(() => app.getByRole('textbox', { name: 'Name' }).textContent()).toContain('ada');

    // Focus moves, and the tree follows it.
    await app.press('Tab');
    await expect
      .poll(async () => (await app.getByRole('textbox', { name: 'Password' }).semanticState())?.focused)
      .toBe(true);
  }, 900_000);

  it('does not publish what a masked field is hiding', async () => {
    // The probe reads component state through public getters, and `Value()`
    // returns the secret regardless of what the widget draws. Publishing it
    // would put a password into the semantic tree, the trace archive and the
    // HTML report. The screen shows dots; so must the tree.
    const binary = await buildFixture();
    const app = await launchTerminal({ command: [binary], columns: 80, rows: 12 });
    sessions.push(app);
    await app.waitForText('Sign in');

    await app.press('Tab');
    await app.type('hunter2');
    // Proof the application really received it, so the assertions below are
    // about withholding rather than about nothing having happened. Bubbles
    // masks with '*' by default, one per character.
    await app.waitForText('*******');

    const value = await app.getByRole('textbox', { name: 'Password' }).textContent();
    expect(value).not.toContain('hunter2');

    // And the whole published tree is checked, not just that one node — a
    // secret leaking through some other field would pass the assertion above.
    const tree = JSON.stringify(app.semanticTree());
    expect(tree).not.toContain('hunter2');
  }, 900_000);
});

describe.skipIf(runnable)('the Charm zero-config arms', () => {
  it('skip because no Go toolchain or no pseudo-terminal is reachable', () => {
    expect(runnable).toBe(false);
  });
});

it('the fixture imports nothing of ours', async () => {
  const source = await readFile(join(FIXTURE, 'main.go'), 'utf8');
  const imports = source.slice(source.indexOf('import ('), source.indexOf('\n)'));

  expect(imports).not.toContain('termwright');
  expect(imports).toContain('charm.land/bubbletea/v2');
});
