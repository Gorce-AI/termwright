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
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ENV_ENDPOINT, ENV_TOKEN, verifyMarkerPayload, MARKER_OSC_CODE, MARKER_OSC_PREFIX } from '@termwright/protocol';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';
import { bunAvailable } from './testing/bun-available.js';

const run = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(packageRoot, 'src', 'testing', 'vanilla-app.ts');

async function ensureBuilt(): Promise<void> {
  const entry = join(packageRoot, 'dist', 'bun-preload.js');
  if ((await stat(entry).catch(() => null)) !== null) return;
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
}): Promise<Run> {
  const entry = pathToFileURL(join(packageRoot, 'dist', 'bun-preload.js')).href;
  const argv = options.driver === undefined ? [app] : ['--preload', entry, app];

  return new Promise((resolve, reject) => {
    const child = spawn('bun', argv, {
      cwd: packageRoot,
      env: {
        ...process.env,
        TW_APP_STEPS: String(options.steps ?? 2),
        ...(options.driver === undefined
          ? { [ENV_ENDPOINT]: '', [ENV_TOKEN]: '' }
          : { [ENV_ENDPOINT]: options.driver.endpoint, [ENV_TOKEN]: options.driver.token }),
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

    // The application wrote a Box, a Text and an Input, and never said a word
    // about semantics.
    expect(roles).toContain('application');
    expect(roles).toContain('text');
    expect(roles).toContain('textbox');
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

    expect(vanilla.stdout).not.toContain(MARKER_OSC_PREFIX);
    expect(instrumented.stdout.replaceAll(markerPattern(), '')).toBe(vanilla.stdout);
  }, 90_000);
});

describe.skipIf(bunAvailable())('coverage note', () => {
  it('skips the zero-config suite because no bun binary is reachable', () => {
    expect(bunAvailable()).toBe(false);
  });
});
