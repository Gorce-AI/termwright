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
import { afterAll, describe, expect, it } from 'vitest';
import { prepareInstrumentedBuild, PROBE_VERSION } from './launch.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'testing', 'fixture-v2');
const FIXTURE_V1 = join(here, 'testing', 'fixture-v1');
const FIXTURE_BUBBLES = join(here, 'testing', 'fixture-bubbles');
const FIXTURE_ANNOTATED = join(here, 'testing', 'fixture-annotated');

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

/**
 * Builds the Bubbles fixture with **both** patch sets applied.
 *
 * Bubble Tea alone gets the frame hook; Bubbles is where the component state
 * lives, and it is a separate module, so instrumenting one without the other
 * reports strictly less.
 */
async function buildBubblesFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-bub-')));
  roots.push(dir);

  const app = join(dir, 'app');
  await mkdir(app, { recursive: true });
  await cp(FIXTURE_BUBBLES, app, { recursive: true });

  const prepared = await prepareInstrumentedBuild({
    moduleDir: app,
    env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') },
  });

  const binary = join(dir, 'app-binary');
  await run('go', ['build', '-o', binary, '.'], {
    cwd: app,
    env: prepared.env,
  });
  return binary;
}

async function buildFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-zc-')));
  roots.push(dir);

  const app = join(dir, 'app');
  await mkdir(app, { recursive: true });
  await cp(FIXTURE, app, { recursive: true });

  const prepared = await prepareInstrumentedBuild({
    moduleDir: app,
    env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') },
  });

  const binary = join(dir, 'app-binary');
  await run('go', ['build', '-o', binary, '.'], {
    cwd: app,
    env: prepared.env,
  });
  return binary;
}

async function buildV1Fixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-v1-')));
  roots.push(dir);
  const app = join(dir, 'app');
  await mkdir(app, { recursive: true });
  await cp(FIXTURE_V1, app, { recursive: true });
  const prepared = await prepareInstrumentedBuild({
    moduleDir: app,
    env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') },
  });
  const binary = join(dir, 'app-binary');
  await run('go', ['build', '-o', binary, '.'], { cwd: app, env: prepared.env });
  return binary;
}

describe.skipIf(!runnable)('an exact Bubble Tea v1 application under the probe', () => {
  it('publishes semantics through real PTY input and answers observable startup queries', async () => {
    const binary = await buildV1Fixture();
    const app = await launchTerminal({ command: [binary], columns: 80, rows: 12 });
    sessions.push(app);

    await app.waitForText('ready');
    await expect.poll(() => app.semanticTree()?.v, { timeout: 10_000 }).toBe(2);
    expect(app.capabilities().probe).toMatchObject({
      framework: 'charm',
      frameworkVersion: 'v1.3.10',
      probeVersion: PROBE_VERSION,
    });
    // ConPTY consumes startup terminal queries before Termwright's emulator
    // can observe and answer them. Semantics and ordinary PTY input remain
    // authoritative there; the terminal-response path is covered by direct VT
    // tests and real PTYs whose query bytes are actually observable.
    if (process.platform !== 'win32') {
      expect(app.diagnostics().some((entry) => entry.code === 'terminal-response')).toBe(true);
    }

    await app.press('x');
    await app.waitForText('changed');
  }, 900_000);
});

describe.skipIf(!runnable)('a plain Bubble Tea application under the probe', () => {
	it('reports unobservable component geometry instead of inventing it', async () => {
		const binary = await buildFixture();
		const app = await launchTerminal({
			command: [binary],
			columns: 80,
			rows: 12,
		});
		sessions.push(app);
		await app.waitForText('Sign in');
		await expect.poll(() => app.semanticTree()?.v, { timeout: 10_000 }).toBe(2);

		const tree = app.semanticTree();
		expect(tree?.hitGrid).toEqual({
			status: 'unsupported',
			capability: 'pointer-hit-grid',
			reason: 'framework-unobservable',
		});
		const textbox = tree?.nodes.find((node) => node.role === 'textbox' && node.name === 'Name');
		expect(textbox?.geometry).toEqual({
			displayed: { status: 'unsupported', capability: 'displayed', reason: 'framework-unobservable' },
			intendedRect: { status: 'unsupported', capability: 'intended-geometry', reason: 'framework-unobservable' },
			visibleRect: { status: 'unsupported', capability: 'clipped-geometry', reason: 'framework-unobservable' },
		});
	}, 900_000);

  it('names the components the screen only shows as text', async () => {
    const binary = await buildFixture();
    const app = await launchTerminal({ command: [binary], columns: 80, rows: 12 });
    sessions.push(app);
    await app.waitForText('Sign in');

    expect(app.capabilities().semanticTree).toBe(true);
    expect(app.capabilities().adapter?.name).toBe('termwright-probe-charm');
    expect(app.capabilities().capabilities).toEqual([
      'tree',
      'states',
      'actions',
      'render-revisions',
    ]);
    // Probe capabilities describe what Bubble Tea lets the instrumentation
    // observe; they are intentionally not the adapter traffic negotiated
    // immediately above.
    expect(app.capabilities().probe).toEqual({
      framework: 'charm',
      frameworkVersion: 'v2.0.8',
      probeVersion: PROBE_VERSION,
      identityKind: 'frame-local',
      capabilities: ['annotations'],
    });

    // The claim: a grid scrape sees two rows of similar-looking text. The tree
    // says which component each is, and which one is focused — neither of
    // which is recoverable from cells.
    await expect
      .poll(async () => (await app.getByRole('textbox', { name: 'Name' }).semanticState())?.focused)
      .toBe(true);
    await expect.poll(() => app.getByRole('textbox', { name: 'Password' }).count()).toBe(1);

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

describe.skipIf(!runnable)('developer annotations', () => {
  it('lets a component answer for itself', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-ann-')));
    roots.push(dir);
    const app = join(dir, 'app');
    await mkdir(app, { recursive: true });
    await cp(FIXTURE_ANNOTATED, app, { recursive: true });

    const prepared = await prepareInstrumentedBuild({
      moduleDir: app,
      env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') },
    });

    const binary = join(dir, 'app-binary');
    await run('go', ['build', '-o', binary, '.'], {
      cwd: app,
      env: prepared.env,
    });

    const session = await launchTerminal({ command: [binary], columns: 60, rows: 10 });
    sessions.push(session);
    await session.waitForText('disk 81%');

    // A component the probe knows nothing about, reported as what its author
    // says it is — through an interface rather than a registry, because a
    // Bubble Tea component is copied on every update.
    await expect.poll(() => session.getByTestId('disk-gauge').count()).toBe(1);
    await expect
      .poll(() => session.getByRole('progressbar', { name: 'Disk usage' }).count())
      .toBe(1);

    // The declaration is recomputed per frame, so domain state follows the
    // component instead of going stale the way a registered copy would.
    await session.press('+');
    await session.waitForText('disk 82%');
    await expect
      .poll(() => session.getByTestId('disk-gauge').extendedState())
      .toEqual({ level: 82, status: 'warning' });

    // The annotated wrapper around a native Bubbles textinput keeps all three
    // layers: the author's name/test id, plus the recognizer's role, focus and
    // live value. Before the regression fix the early annotation return made
    // this a generic node with neither state nor value.
    await expect.poll(() => session.getByTestId('server-host').count()).toBe(1);
    const annotatedNode = () =>
      session.semanticTree()?.nodes.find((node) => node.testId === 'server-host');
    const firstID = annotatedNode()?.id;
    expect(firstID).toBeDefined();
    expect(annotatedNode()?.actions).toEqual(['focus', 'setValue']);
    expect(annotatedNode()?.p).toBe('framework');
    expect(annotatedNode()?.px).toEqual(
      expect.objectContaining({
        id: 'annotation',
        name: 'annotation',
        actions: 'annotation',
        labelledBy: 'annotation',
        describedBy: 'annotation',
        role: 'recognizer',
      }),
    );
    const label = session
      .semanticTree()
      ?.nodes.find((node) => node.name === 'Server host' && node.role === 'text');
    const help = session.semanticTree()?.nodes.find((node) => node.name === 'DNS host name');
    expect(annotatedNode()?.labelledBy).toEqual([label?.id]);
    expect(annotatedNode()?.describedBy).toEqual([help?.id]);
    await expect
      .poll(
        async () =>
          (
            await session
              .getByRole('textbox', { name: 'Server host' })
              .semanticState()
          )?.focused,
      )
      .toBe(true);
    await session.type('prod-01');
    await expect
      .poll(() => session.getByTestId('server-host').textContent())
      .toContain('prod-01');
    expect(annotatedNode()?.id).toBe(firstID);
  }, 900_000);
});

describe.skipIf(!runnable)('the Bubbles patch set, end to end', () => {
  it('reports state the library keeps entirely private', async () => {
    const binary = await buildBubblesFixture();
    const app = await launchTerminal({
      command: [binary],
      columns: 60,
      rows: 10,
      semanticNegotiationMs: 2_000,
    });
    sessions.push(app);
    await app.waitForText('Loading');

    // A spinner has no public frame index at all: from outside the library it
    // is a glyph, and "animating" is indistinguishable from "stuck". The
    // accessor makes the frame observable, so the tree can show it advancing.
    // Polled rather than settled: this application animates forever, so
    // waitForStable() waits for a quiet screen that never comes. An
    // always-animating UI is exactly the case where "wait for stability" is
    // the wrong instrument, and reaching for it here cost a red test.
    const frames = new Set<number | undefined>();
    await expect
      .poll(
        async () => {
          frames.add((await app.getByRole('status').semanticState())?.positionInSet);
          return frames.size;
        },
        { timeout: 20_000, interval: 60 },
      )
      .toBeGreaterThan(1);

    // progress.Percent() returns the target of the animation, not the
    // fraction being drawn. The accessor reports the drawn one, and the
    // difference is not academic: the spring approaches 0.42 asymptotically
    // and settles just short of it, so the public getter would say 0.420 for a
    // bar that never draws 0.420. Asserting equality with the target is
    // exactly the mistake this accessor exists to make impossible.
    await expect
      .poll(
        async () => Number(await app.getByRole('progressbar').textContent()),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0.4);

    const drawn = Number(await app.getByRole('progressbar').textContent());
    expect(drawn).toBeLessThanOrEqual(0.42);
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
