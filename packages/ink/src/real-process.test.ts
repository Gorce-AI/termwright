/**
 * The design's risk #1, run for real: an Ink app in its own process, a driver
 * on the other end of a unix socket, and the question of whether the DCS marker
 * lands in stdout *after* the bytes of the frame it commits.
 *
 * Everything else in this package is tested against an in-memory stream; this
 * file is the one that would catch a discrepancy between that model and a real
 * pipe with real backpressure.
 */

import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { stat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MARKER_DCS_PREFIX } from '@termwright/protocol';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';
import { markersIn, stripMarkers } from './testing/markers.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(packageRoot, 'src', 'testing', 'fixture-app.mjs');
const bundle = join(packageRoot, 'dist', 'index.js');

/** Build the package if `dist` is missing or older than any source file. */
async function ensureBuilt(): Promise<void> {
  const sources = await readdir(join(packageRoot, 'src'), { recursive: true, withFileTypes: true });
  let newestSource = 0;
  for (const entry of sources) {
    if (!entry.isFile()) continue;
    const { mtimeMs } = await stat(join(entry.parentPath, entry.name));
    newestSource = Math.max(newestSource, mtimeMs);
  }

  const built = await stat(bundle).catch(() => null);
  if (built !== null && built.mtimeMs > newestSource) return;

  await promisify(execFile)('npm', ['run', 'build'], { cwd: packageRoot });
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

function runFixture(env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture], {
      cwd: packageRoot,
      env: { ...process.env, ...env },
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

describe('real process', () => {
  const openDrivers: FakeDriver[] = [];

  beforeAll(async () => {
    await ensureBuilt();
  }, 120_000);

  afterEach(async () => {
    for (const driver of openDrivers.splice(0)) await driver.close();
  });

  it('emits each marker after the frame it commits, and pairs it with a tree', async () => {
    const driver = await startFakeDriver();
    openDrivers.push(driver);

    const result = await runFixture({
      TERMWRIGHT_ENDPOINT: driver.endpoint,
      TERMWRIGHT_TOKEN: driver.token,
      TERMWRIGHT_PROTOCOL: '1',
      TW_LABELS: 'Approve,Reject',
    });

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    const hello = await driver.waitForHandshake();
    expect(hello.adapter.name).toBe('@termwright/ink');
    expect(hello.capabilities).toContain('absolute-bounds');

    const snapshots = await driver.waitForSnapshots(2);
    expect(snapshots.map((snapshot) => snapshot.revision)).toEqual(
      [...snapshots].map((snapshot) => snapshot.revision).sort((a, b) => a - b),
    );
    expect(
      snapshots.every((snapshot) =>
        snapshot.nodes.some((node) => node.role === 'button' && node.testId === 'action'),
      ),
    ).toBe(true);

    const markers = markersIn(result.stdout, driver.token, driver.sessionId);
    expect(markers.length).toBeGreaterThanOrEqual(2);

    const firstFrame = result.stdout.indexOf('Approve');
    const secondFrame = result.stdout.indexOf('Reject');
    expect(firstFrame).toBeGreaterThanOrEqual(0);
    expect(secondFrame).toBeGreaterThan(firstFrame);

    const markerFor = (revision: number): number => {
      const entry = markers.find((candidate) => candidate.revision === revision);
      if (entry === undefined) throw new Error(`no marker for revision ${revision}`);
      return entry.index;
    };

    const [first, second] = snapshots;
    expect(markerFor(first!.revision)).toBeGreaterThan(firstFrame);
    expect(markerFor(first!.revision)).toBeLessThan(secondFrame);
    expect(markerFor(second!.revision)).toBeGreaterThan(secondFrame);
  }, 30_000);

  it('is byte-identical to an uninstrumented run when no driver is present', async () => {
    const driver = await startFakeDriver();
    openDrivers.push(driver);

    const instrumented = await runFixture({
      TERMWRIGHT_ENDPOINT: driver.endpoint,
      TERMWRIGHT_TOKEN: driver.token,
      TERMWRIGHT_PROTOCOL: '1',
      TW_LABELS: 'Approve,Reject',
    });
    const dormant = await runFixture({
      TERMWRIGHT_ENDPOINT: '',
      TERMWRIGHT_TOKEN: '',
      TW_LABELS: 'Approve,Reject',
    });

    expect(dormant.stdout).not.toContain(MARKER_DCS_PREFIX);
    expect(stripMarkers(instrumented.stdout)).toBe(dormant.stdout);
    expect(await driver.waitForSnapshots(1)).not.toHaveLength(0);
  }, 30_000);
});
