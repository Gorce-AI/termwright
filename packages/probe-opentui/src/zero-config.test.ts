/**
 * Level C: the claim itself.
 *
 * A perfectly ordinary OpenTUI application — no termwright import, no
 * configuration, no annotation — launched by our launcher, publishes a semantic
 * tree to a driver. Everything else in this package is a piece of that
 * sentence; this is the sentence.
 *
 * Bun only. `bun:ffi` is OpenTUI's supported backend, and these tests skip with
 * the reason in their name where no Bun is reachable rather than pretending to
 * cover it.
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ENV_ENDPOINT, ENV_PROTOCOL, ENV_TOKEN, PROTOCOL_V2_ID, verifyMarkerPayload, MARKER_OSC_CODE, MARKER_OSC_PREFIX } from '@termwright/protocol';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';
import { bunAvailable } from './testing/bun-available.js';

const run = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(packageRoot, 'src', 'testing', 'vanilla-app.ts');
const annotatedApp = join(packageRoot, 'src', 'testing', 'annotated-app.ts');
const annotationSdkRoot = join(packageRoot, '..', 'opentui');

async function ensureBuilt(): Promise<void> {
  await run('npm', ['run', 'build'], { cwd: annotationSdkRoot });
  // Process tests execute dist, so an existing entry is not evidence that it
  // represents the current source. Always rebuild instead of testing a stale
  // preload left by an earlier run.
  await run('npm', ['run', 'build'], { cwd: packageRoot });
}

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

/** Launch the vanilla app, optionally with the probe attached. */
function launch(options: {
  readonly driver?: FakeDriver;
  readonly steps?: number;
  readonly appPath?: string;
  readonly protocol?: 'termwright/1' | 'termwright/2';
}): Promise<Run> {
  const entry = pathToFileURL(join(packageRoot, 'dist', 'bun-preload.js')).href;
  const targetApp = options.appPath ?? app;
  const argv = options.driver === undefined ? [targetApp] : ['--preload', entry, targetApp];

  return new Promise((resolve, reject) => {
    const child = spawn('bun', argv, {
      cwd: packageRoot,
      env: {
        ...process.env,
        TW_APP_STEPS: String(options.steps ?? 2),
        ...(options.driver === undefined
          ? { [ENV_ENDPOINT]: '', [ENV_TOKEN]: '' }
          : { [ENV_ENDPOINT]: options.driver.endpoint, [ENV_TOKEN]: options.driver.token, ...(options.protocol === undefined ? {} : { [ENV_PROTOCOL]: options.protocol }) }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

function markerPattern(): RegExp {
  return new RegExp(
    `\\u001b\\]${MARKER_OSC_CODE};(${MARKER_OSC_PREFIX}[^\\u0007\\u001b]*)(?:\\u0007|\\u001b\\\\)`,
    'gu',
  );
}

describe('the fixture premise', () => {
  it('keeps the vanilla zero-config fixture free of Termwright imports', async () => {
    const source = await readFile(app, 'utf8');
    expect(source).toContain("from '@opentui/core'");
    expect(source).not.toContain('@termwright');
  });
});

describe.skipIf(!bunAvailable())('a vanilla OpenTUI app, instrumented by the launcher', () => {
  const open: FakeDriver[] = [];

  beforeAll(async () => {
    await ensureBuilt();
  }, 180_000);

  afterEach(async () => {
    for (const driver of open.splice(0)) await driver.close();
  });

  it('publishes a semantic tree without importing anything of ours', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    const result = await launch({ driver, steps: 2 });
    expect(result.stderr).toBe('');

    const hello = await driver.waitForHandshake();
    expect(hello.probe?.framework).toBe('opentui');
    expect(hello.probe?.identityKind).toBe('stable');

    const [snapshot] = await driver.waitForSnapshots(1);
    const roles = snapshot!.nodes.map((node) => node.role);

    // The application wrote ordinary framework widgets and never said a word
    // about semantics. The class recognizer supplies only roles that are
    // unambiguous in the protocol vocabulary.
    expect(roles).toContain('application');
    expect(roles).toContain('text');
    expect(roles).toContain('textbox');
    expect(snapshot!.nodes.find(
      (node) => node.frameworkType === 'SelectRenderable',
    )).toMatchObject({ role: 'list' });
    expect(snapshot!.nodes.find(
      (node) => node.frameworkType === 'TextTableRenderable',
    )).toMatchObject({ role: 'table' });

    // A ScrollBox is deliberately not mislabeled as a scrollbar or region.
    // Unknown widgets survive with the framework's own type and their subtree.
    const scrollBox = snapshot!.nodes.find(
      (node) => node.frameworkType === 'ScrollBoxRenderable',
    );
    expect(scrollBox).toMatchObject({ role: 'generic', name: '' });
    const activity = snapshot!.nodes.find((node) => node.name === 'Activity 1');
    const byId = new Map(snapshot!.nodes.map((node) => [node.id, node]));
    let ancestor = activity?.parentId;
    while (ancestor !== undefined && ancestor !== scrollBox?.id) {
      ancestor = byId.get(ancestor)?.parentId;
    }
    expect(activity, 'the application-owned ScrollBox child survives').toBeDefined();
    expect(ancestor).toBe(scrollBox?.id);
  }, 60_000);

  it('merges an annotation on a custom Renderable with framework geometry', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    await launch({ driver, appPath: annotatedApp });
    const hello = await driver.waitForHandshake();
    const [snapshot] = await driver.waitForSnapshots(1);
    const label = snapshot?.nodes.find((node) => node.testId === 'deploy-label');
    const deployment = snapshot?.nodes.find((node) => node.testId === 'deploy-production');

    expect(deployment).toMatchObject({
      frameworkType: 'DeploymentRenderable',
      role: 'button',
      name: 'Deploy production',
      description: 'Starts the production deployment',
      extended: { environment: 'production', retries: 2 },
      actions: ['activate'],
      labelledBy: [label?.id],
      describedBy: [label?.id],
      bounds: expect.objectContaining({ width: 24, height: 3 }),
      p: 'annotation',
      px: expect.objectContaining({ bounds: 'framework' }),
    });
    expect(hello.capabilities).toContain('actions');
    expect(deployment?.state?.focused).not.toBe(true);
    expect(deployment?.value).toBeUndefined();
  }, 60_000);

  it('follows a value the application changed', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    await launch({ driver, steps: 3 });
    const snapshots = await driver.waitForSnapshots(2);

    const values = snapshots
      .map((snapshot) => snapshot.nodes.find((node) => node.role === 'textbox')?.value)
      .filter((value): value is string => value !== undefined);

    // The app types into the field on every step; at least one snapshot has to
    // show a value it set, or the probe is reporting a stale tree.
    expect(values.some((value) => value.startsWith('typed'))).toBe(true);
  }, 60_000);

  it('follows observable selection and scroll state', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    await launch({ driver, steps: 3 });
    const snapshots = await driver.waitForSnapshots(2);

    const selectedPositions = snapshots
      .map((snapshot) => snapshot.nodes.find((node) => node.role === 'list')?.state?.positionInSet)
      .filter((position): position is number => position !== undefined);
    const scrollStates = snapshots
      .map((snapshot) => snapshot.nodes.find(
        (node) => node.frameworkType === 'ScrollBoxRenderable',
      )?.state)
      .filter((state) => state !== undefined);

    // Select exposes a highlighted index, while ScrollBox exposes position and
    // extent. These assertions require values changed by the application, so a
    // probe that publishes only its initial tree cannot pass.
    expect(new Set(selectedPositions).size).toBeGreaterThan(1);
    expect(scrollStates.some((state) => (state.scrollOffset ?? 0) > 0)).toBe(true);
    expect(scrollStates.some((state) => (state.scrollExtent ?? 0) > 4)).toBe(true);
  }, 60_000);

  it('marks each revision it published, and the markers verify', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    const result = await launch({ driver, steps: 2 });
    const snapshots = await driver.waitForSnapshots(1);

    const revisions = [...result.stdout.matchAll(markerPattern())]
      .map((match) => verifyMarkerPayload(match[1] as string, driver.token, driver.sessionId))
      .filter((marker) => marker !== null);

    expect(revisions.length).toBeGreaterThan(0);
    // A marker authenticates against the session, so a forged one from
    // application output cannot be mistaken for a commit.
    expect(revisions.map((marker) => marker!.revision)).toContain(snapshots[0]!.revision);
  }, 60_000);

  it('is byte-identical to an uninstrumented run, apart from the markers', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    const instrumented = await launch({ driver, steps: 2 });
    const vanilla = await launch({ steps: 2 });

    expect(instrumented.code).toBe(0);
    expect(vanilla.code).toBe(0);
    expect(instrumented.stderr).toBe(vanilla.stderr);
    expect(vanilla.stdout).not.toContain(MARKER_OSC_PREFIX);
    expect(instrumented.stdout.replaceAll(markerPattern(), '')).toBe(vanilla.stdout);
  }, 90_000);

  it('publishes qualified v2 geometry and the native exact hit grid', async () => {
    const driver = await startFakeDriver(PROTOCOL_V2_ID);
    open.push(driver);
    await launch({ driver, steps: 2, protocol: PROTOCOL_V2_ID });
    const hello = await driver.waitForHandshake();
    expect(hello.protocol).toBe(PROTOCOL_V2_ID);
    expect(hello.capabilities).toContain('pointer-hit-grid');
    const [snapshot] = await driver.waitForSnapshots(1);
    expect(snapshot?.v).toBe(2);
    expect(snapshot?.coordinateSpace).toMatchObject({ status: 'known', value: 'viewport-cells' });
    expect(snapshot?.hitGrid).toMatchObject({ status: 'known' });
    expect(snapshot?.nodes.some((node) => node.geometry?.intendedRect.status === 'known')).toBe(true);
    expect(snapshot?.nodes.every((node) => node.bounds === undefined && node.occlusion === undefined)).toBe(true);
  }, 60_000);
});

describe.skipIf(bunAvailable())('coverage note', () => {
  it('skips the zero-config suite because no bun binary is reachable', () => {
    expect(bunAvailable()).toBe(false);
  });
});
