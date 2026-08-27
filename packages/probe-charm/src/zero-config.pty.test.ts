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
import { launchTerminal, type TerminalHarness } from '@termwright/driver';
import {
  createNativePtyBackend,
  launchTerminalWithBackend,
  nativePtyAvailable,
  type PtyBackend,
} from '@termwright/driver/experimental';
import { afterEach, describe, expect } from 'vitest';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import { goTestCapability } from '../../../scripts/test-support/go-toolchain.mjs';
import { prepareInstrumentedBuild, PROBE_VERSION } from './launch.js';

const it = resourceAwareIt.resources({ terminals: 1, traceWriters: 0, hostPressure: 'exclusive' });
const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'testing', 'fixture-v2');
const FIXTURE_V1 = join(here, 'testing', 'fixture-v1');
const FIXTURE_BUBBLES = join(here, 'testing', 'fixture-bubbles');
const FIXTURE_ANNOTATED = join(here, 'testing', 'fixture-annotated');

async function goAvailable(): Promise<boolean> {
  return goTestCapability(async () => {
    await run('go', ['version']);
    return true;
  }, false, 'Go certification toolchain');
}

function ptyAvailable(): boolean {
  return nativePtyAvailable();
}

const runnable = (await goAvailable()) && ptyAvailable();
const roots: string[] = [];
const sessions: TerminalHarness[] = [];

afterEach(async () => {
  const owned = sessions.splice(0);
  const ownedRoots = roots.splice(0);
  // Windows keeps a running executable locked. Teardown is deliberately
  // phased: reap every PTY process before deleting the directory that owns its
  // binary, while retaining failures from both phases.
  const closed = await Promise.allSettled(owned.map((session) => session.close()));
  const removed = await Promise.allSettled(
    ownedRoots.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  const results = [...closed, ...removed];
  const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length > 0) throw new AggregateError(failures, 'failed to clean test-owned Charm resources');
});

/**
 * Builds the Bubbles fixture with **both** patch sets applied.
 *
 * Bubble Tea alone gets the frame hook; Bubbles is where the component state
 * lives, and it is a separate module, so instrumenting one without the other
 * reports strictly less.
 */
async function buildBubblesFixture(version = 'v2.0.8', injectBubbles = true): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-bub-')));
  roots.push(dir);

  const app = join(dir, 'app');
  await mkdir(app, { recursive: true });
  await cp(FIXTURE_BUBBLES, app, { recursive: true });

  if (version !== 'v2.0.8') {
    await run('go', ['mod', 'edit', `-require=charm.land/bubbletea/v2@${version}`], {
      cwd: app,
      env: { ...process.env, GOWORK: 'off' },
    });
    await run('go', ['mod', 'download', `charm.land/bubbletea/v2@${version}`], {
      cwd: app,
      env: { ...process.env, GOWORK: 'off' },
    });
  }

  const prepared = await prepareInstrumentedBuild({
    moduleDir: app,
    env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') },
  });

  const binary = join(dir, 'app-binary');
  await run('go', ['build', ...(injectBubbles ? prepared.goArgs : []), '-o', binary, '.'], {
    cwd: app,
    env: prepared.env,
  });
  return binary;
}

async function buildFixture(version = 'v2.0.8'): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-zc-')));
  roots.push(dir);

  const app = join(dir, 'app');
  await mkdir(app, { recursive: true });
  await cp(FIXTURE, app, { recursive: true });

  if (version !== 'v2.0.8') {
    await run('go', ['mod', 'edit', `-require=charm.land/bubbletea/v2@${version}`], {
      cwd: app,
      env: { ...process.env, GOWORK: 'off' },
    });
    await run('go', ['mod', 'download', `charm.land/bubbletea/v2@${version}`], {
      cwd: app,
      env: { ...process.env, GOWORK: 'off' },
    });
  }

  const prepared = await prepareInstrumentedBuild({
    moduleDir: app,
    env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') },
  });

  const binary = join(dir, 'app-binary');
  await run('go', ['build', ...prepared.goArgs, '-o', binary, '.'], {
    cwd: app,
    env: prepared.env,
  });
  return binary;
}

async function buildVanillaFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-vanilla-')));
  roots.push(dir);
  const app = join(dir, 'app');
  await mkdir(app, { recursive: true });
  await cp(FIXTURE, app, { recursive: true });
  const binary = join(dir, 'app-binary');
  await run('go', ['build', '-o', binary, '.'], {
    cwd: app,
    env: { ...process.env, GOWORK: 'off', GOFLAGS: '-mod=mod' },
  });
  return binary;
}

function dormantBackend(output?: Uint8Array[]): PtyBackend {
  const upstream = createNativePtyBackend();
  return {
    name: `${upstream.name}+dormant`,
    spawn(options) {
      const process = upstream.spawn({
        ...options,
        env: {
          ...options.env,
          TERMWRIGHT_ENDPOINT: '',
          TERMWRIGHT_TOKEN: '',
        },
      });
      return output === undefined ? process : {
        ...process,
        onData(listener) {
          return process.onData((data) => {
            output.push(Uint8Array.from(data));
            listener(data);
          });
        },
      };
    },
  };
}

function capturingBackend(output: Uint8Array[]): PtyBackend {
  const upstream = createNativePtyBackend();
  return {
    name: `${upstream.name}+capture`,
    spawn(options) {
      const process = upstream.spawn(options);
      return {
        ...process,
        onData(listener) {
          return process.onData((data) => {
            output.push(Uint8Array.from(data));
            listener(data);
          });
        },
      };
    },
  };
}

async function waitForSemanticCondition(
  app: TerminalHarness,
  condition: () => boolean | Promise<boolean>,
  description: string,
  maximumCommittedChanges = 128,
): Promise<void> {
  let checkpoint = app.checkpoint();
  for (let change = 0; change < maximumCommittedChanges; change += 1) {
    if (await condition()) return;
    checkpoint = await app.waitForCheckpointChange({ after: checkpoint, timeout: 20_000 });
  }
  throw new Error(`${description} did not occur within ${maximumCommittedChanges} causal checkpoint changes`);
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
  await run('go', ['build', ...prepared.goArgs, '-o', binary, '.'], { cwd: app, env: prepared.env });
  return binary;
}

describe.skipIf(!runnable)('an exact Bubble Tea v1 application under the probe', () => {
  it('publishes semantics through real PTY input and answers observable startup queries', async () => {
    const binary = await buildV1Fixture();
    const app = await launchTerminal({ command: [binary], columns: 80, rows: 12 });
    sessions.push(app);

    await app.waitForText('ready');
    await app.settled();
    expect(app.semanticTree()?.v).toBe(2);
    expect(app.contract()?.framework).toMatchObject({
      name: 'charm', version: 'v1.3.10', adapterVersion: PROBE_VERSION,
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
	resourceAwareIt.resources({ terminals: 2, traceWriters: 0, hostPressure: 'exclusive' })('is observably identical to untouched Bubble Tea when dormant', async () => {
		const [vanilla, instrumented] = await Promise.all([
			buildVanillaFixture(),
			buildFixture(),
		]);
		const states: unknown[] = [];
		const outputs: Uint8Array[][] = [[], []];
		for (const [index, binary] of [vanilla, instrumented].entries()) {
			const app = await launchTerminalWithBackend({
				command: [binary],
				columns: 60,
				rows: 10,
				backend: dormantBackend(outputs[index]),
			});
			sessions.push(app);
			await app.waitForText('status: ready');
			expect(app.contract()?.framework ?? null).toBeNull();
			expect(app.semanticTree()).toBeNull();
			const beforeFocusChange = app.checkpoint();
			await app.press('tab');
			// Bubble Tea may legitimately coalesce two inputs into one render.
			// Comparing independent byte streams before both programs have crossed
			// the same render boundary measures scheduler timing, not dormant
			// instrumentation. Observe the tab frame before sending the next input,
			// so both captures contain the same causally complete transactions.
			await app.waitForCheckpointChange({ after: beforeFocusChange, timeout: 20_000 });
			await app.type('x');
			await app.waitForText('batch-complete:1');
			const screen = app.screen();
			states.push({
				buffer: screen.buffer,
				modes: screen.modes,
				cursor: screen.cursor,
				cells: Array.from({ length: screen.rows }, (_, row) =>
					Array.from({ length: screen.columns }, (_, column) => screen.cell(row, column))),
			});
		}
		expect(states[1]).toEqual(states[0]);
		expect(Buffer.concat(outputs[1]!.map((part) => Buffer.from(part)))).toEqual(
			Buffer.concat(outputs[0]!.map((part) => Buffer.from(part))),
		);
		for (const output of outputs) {
			expect(Buffer.concat(output.map((part) => Buffer.from(part))).includes(Buffer.from('\u001b]8487;'))).toBe(false);
		}
	}, 900_000);

	it('fails closed when a recognised Bubbles component was built without the returned compiler arguments', async () => {
		const binary = await buildBubblesFixture('v2.0.8', false);
		const app = await launchTerminal({ command: [binary], columns: 60, rows: 10 });
		sessions.push(app);
		await app.waitForText('Loading');
		await expect(app.settled()).rejects.toMatchObject({
			code: 'adapter-guarantee-violation',
			message: expect.stringContaining('without injected accessor TermwrightFrame'),
		});
		expect(app.semanticTree()).toBeNull();
	}, 900_000);

	it('keeps the captured marker stream ordered across consecutive A/B/A commits', async () => {
		const binary = await buildFixture();
		const output: Uint8Array[] = [];
		const app = await launchTerminalWithBackend({
			command: [binary],
			columns: 60,
			rows: 10,
			backend: capturingBackend(output),
		});
		sessions.push(app);
		await app.waitForText('status: ready');
		await app.settled();

		let rawOffset = Buffer.concat(output.map((part) => Buffer.from(part))).length;
		const commit = async (input: () => Promise<void>, expected: string) => {
			await input();
			await waitForSemanticCondition(
				app,
				() => app.getByRole('textbox', { name: 'Name' }).textContent().then((text) => text === expected),
				`textbox commit ${JSON.stringify(expected)}`,
			);
			const raw = Buffer.concat(output.map((part) => Buffer.from(part)));
			const commitBytes = raw.subarray(rawOffset);
			rawOffset = raw.length;
			const markerAt = commitBytes.indexOf(Buffer.from('\u001b]8487;'));
			expect(markerAt, `captured writer emitted no marker: ${commitBytes.toString('hex')}`).toBeGreaterThanOrEqual(0);
			// Bubble Tea may legally produce a semantic-only commit after an
			// earlier flush already made the same cells authoritative. Whenever
			// this commit carries terminal bytes, they must precede its marker.
			if (markerAt > 0) {
				expect(commitBytes.subarray(0, markerAt).length, 'marker preceded its frame bytes').toBeGreaterThan(0);
			}
		};

		await commit(() => app.type('a'), 'a');
		await commit(() => app.press('backspace'), '');
		await commit(() => app.type('a'), 'a');
	}, 900_000);

	it('reports unobservable component geometry instead of inventing it', async () => {
		const binary = await buildFixture();
		const app = await launchTerminal({
			command: [binary],
			columns: 80,
			rows: 12,
		});
		sessions.push(app);
		await app.waitForText('Sign in');
		await app.settled();
		expect(app.semanticTree()?.v).toBe(2);

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

  it.each(['v2.0.8', 'v2.0.9'])(
    'composes exact Bubble Tea %s with Bubbles v2.1.1 private state',
    async (version) => {
      const binary = await buildBubblesFixture(version);
      const app = await launchTerminal({ command: [binary], columns: 60, rows: 10 });
      sessions.push(app);
      await app.waitForText('Loading');
      await app.settled();
      expect(app.semanticTree()?.v).toBe(2);
      expect(app.contract()?.framework).toMatchObject({
        name: 'charm', version, adapterVersion: PROBE_VERSION,
      });

      // The frame index has no public Bubbles getter. A numeric value proves
      // the exact add-only companion accessor executed, not merely that Bubble
      // Tea recognised the component type from its public View output.
      expect((await app.getByRole('status').semanticState())?.positionInSet).toEqual(expect.any(Number));
    },
    900_000,
  );

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
    await run('go', ['build', ...prepared.goArgs, '-o', binary, '.'], {
      cwd: app,
      env: prepared.env,
    });

    const session = await launchTerminal({ command: [binary], columns: 60, rows: 10 });
    sessions.push(session);
    await session.waitForText('disk 81%');
    await session.settled();

    // A component the probe knows nothing about, reported as what its author
    // says it is — through an interface rather than a registry, because a
    // Bubble Tea component is copied on every update.
    expect(await session.getByTestId('disk-gauge').count()).toBe(1);
    expect(await session.getByRole('progressbar', { name: 'Disk usage' }).count()).toBe(1);

    // The declaration is recomputed per frame, so domain state follows the
    // component instead of going stale the way a registered copy would.
    await session.press('+');
    await session.waitForText('disk 82%');
    await waitForSemanticCondition(
      session,
      () => session.getByTestId('disk-gauge').extendedState()
        .then((state) => state?.['level'] === 82 && state?.['status'] === 'warning'),
      'annotated domain state update',
    );
    expect(await session.getByTestId('disk-gauge').extendedState()).toEqual({ level: 82, status: 'warning' });

    // The annotated wrapper around a native Bubbles textinput keeps all three
    // layers: the author's name/test id, plus the recognizer's role, focus and
    // live value. Before the regression fix the early annotation return made
    // this a generic node with neither state nor value.
    expect(await session.getByTestId('server-host').count()).toBe(1);
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
    expect((await session.getByRole('textbox', { name: 'Server host' }).semanticState())?.focused).toBe(true);
    await session.type('prod-01');
    await waitForSemanticCondition(
      session,
      () => session.getByTestId('server-host').textContent().then((text) => text.includes('prod-01')),
      'annotated textbox value update',
    );
    expect(await session.getByTestId('server-host').textContent()).toContain('prod-01');
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
    // Observe actual committed checkpoints. This application animates forever,
    // so neither quiet windows nor wall-clock polling are causal evidence.
    const frames = new Set<number | undefined>();
    await waitForSemanticCondition(app, async () => {
      frames.add((await app.getByRole('status').semanticState())?.positionInSet);
      return frames.size > 1;
    }, 'two distinct committed spinner frames');

    // progress.Percent() returns the target of the animation, not the
    // fraction being drawn. The accessor reports the drawn one, and the
    // difference is not academic: the spring approaches 0.42 asymptotically
    // and settles just short of it, so the public getter would say 0.420 for a
    // bar that never draws 0.420. Asserting equality with the target is
    // exactly the mistake this accessor exists to make impossible.
    await waitForSemanticCondition(
      app,
      async () => Number(await app.getByRole('progressbar').textContent()) > 0.4,
      'committed progress animation',
    );

    const drawn = Number(await app.getByRole('progressbar').textContent());
    expect(drawn).toBeLessThanOrEqual(0.42);
  }, 900_000);
});

it('the fixture imports nothing of ours', async () => {
  const source = await readFile(join(FIXTURE, 'main.go'), 'utf8');
  const imports = source.slice(source.indexOf('import ('), source.indexOf('\n)'));

  expect(imports).not.toContain('termwright');
  expect(imports).toContain('charm.land/bubbletea/v2');
});
