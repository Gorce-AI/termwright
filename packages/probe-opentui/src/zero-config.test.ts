/**
 * Level C: the claim itself.
 *
 * A perfectly ordinary OpenTUI application — no termwright import, no
 * configuration, no annotation — launched by our launcher, publishes a semantic
 * tree to a driver. Everything else in this package is a piece of that
 * sentence; this is the sentence.
 *
 * Bun only. `bun:ffi` is OpenTUI's supported backend. Local runs may record the
 * exact Bun-only cases as applicability skips; certifying jobs require Bun and
 * fail during discovery when it is unavailable.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ENV_ENDPOINT, ENV_TOKEN, PROTOCOL_ID, verifyMarkerPayload, MARKER_OSC_CODE, MARKER_OSC_PREFIX } from '@termwright/protocol';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';
import { bunAvailable } from './testing/bun-available.js';
import { runtimePreloadSpecifier } from './launch.js';
import { requireImmutableBuildInputs } from '../../../scripts/test-support/immutable-build-inputs.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(packageRoot, 'src', 'testing', 'vanilla-app.ts');
const annotatedApp = join(packageRoot, 'src', 'testing', 'annotated-app.ts');
const geometryApp = join(packageRoot, 'src', 'testing', 'geometry-app.ts');
const runtimeConformanceApp = join(packageRoot, 'src', 'testing', 'runtime-conformance-app.ts');
const annotationSdkRoot = join(packageRoot, '..', 'opentui');
const openTuiEntry = createRequire(import.meta.url).resolve('@opentui/core');
const installedOpenTuiVersion = (JSON.parse(readFileSync(join(dirname(openTuiEntry), 'package.json'), 'utf8')) as { version: string }).version;

async function requireBuiltInputs(): Promise<void> {
  await requireImmutableBuildInputs([
    join(annotationSdkRoot, 'dist', 'index.js'),
    join(packageRoot, 'dist', 'bun-preload.js'),
  ], {
    label: '@termwright/probe-opentui zero-config tests',
    buildCommand: 'pnpm --filter @termwright/opentui --filter @termwright/probe-opentui build',
  });
}

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly oracle: string;
  readonly code: number | null;
}

/** Launch the vanilla app, optionally with the probe attached. */
function launch(options: {
  readonly driver?: FakeDriver;
  readonly steps?: number;
    readonly appPath?: string;
    readonly fixtureEnv?: Readonly<Record<string, string>>;
    readonly controlled?: boolean;
    readonly captureOracle?: boolean;
    readonly onSpawn?: (child: ChildProcess) => void;
  }): Promise<Run> {
  const entry = runtimePreloadSpecifier('bun', join(packageRoot, 'dist', 'bun-preload.js'));
  const targetApp = options.appPath ?? app;
  const argv = options.driver === undefined ? [targetApp] : ['--preload', entry, targetApp];

  return new Promise((resolve, reject) => {
    const child = spawn('bun', argv, {
      cwd: packageRoot,
      env: {
        ...process.env,
        ...options.fixtureEnv,
        TW_APP_STEPS: String(options.steps ?? 2),
        ...(options.driver === undefined
          ? { [ENV_ENDPOINT]: '', [ENV_TOKEN]: '' }
          : { [ENV_ENDPOINT]: options.driver.endpoint, [ENV_TOKEN]: options.driver.token }),
      },
      stdio: [
        options.controlled === true ? 'pipe' : 'ignore',
        'pipe',
        'pipe',
        options.captureOracle === true ? 'pipe' : 'ignore',
      ],
    });
    if (child.stdout === null || child.stderr === null) {
      child.kill();
      reject(new Error('OpenTUI fixture process has no captured stdout/stderr'));
      return;
    }
    options.onSpawn?.(child);

    let stdout = '';
    let stderr = '';
    let oracle = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const oracleStream = child.stdio[3];
    if (options.captureOracle === true && oracleStream !== undefined && oracleStream !== null && 'setEncoding' in oracleStream) {
      oracleStream.setEncoding('utf8');
      oracleStream.on('data', (chunk: string) => {
        oracle += chunk;
      });
    }
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, oracle, code }));
  });
}

async function launchInstrumented(
  options: Parameters<typeof launch>[0] & { readonly driver: FakeDriver },
): Promise<Run> {
  const result = await launch(options);
  if (result.code !== 0) {
    throw new Error(
      `instrumented Bun application exited with ${String(result.code)} before probe evidence: ` +
      (result.stderr.trim() || '<empty stderr>'),
    );
  }
  return result;
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
    await requireBuiltInputs();
  }, 180_000);

  afterEach(async () => {
    for (const driver of open.splice(0)) await driver.close();
  });

  it('publishes a semantic tree without importing anything of ours', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    const result = await launchInstrumented({ driver, steps: 2 });
    expect(result.stderr).toBe('');

    const hello = await driver.waitForHandshake();
    expect(hello.probe?.framework).toBe('opentui');
    expect(hello.probe?.frameworkVersion).toBe(installedOpenTuiVersion);
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

    await launchInstrumented({ driver, appPath: annotatedApp });
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
      geometry: expect.objectContaining({
        intendedRect: expect.objectContaining({
          status: 'known',
          value: expect.objectContaining({ width: 24, height: 3 }),
        }),
      }),
      p: 'annotation',
      px: expect.objectContaining({ geometry: 'framework' }),
    });
    expect(hello.capabilities).toContain('actions');
    expect(deployment?.state?.focused).not.toBe(true);
    expect(deployment?.value).toBeUndefined();
  }, 60_000);

  it('follows a value the application changed', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    await launchInstrumented({ driver, steps: 3 });
    const snapshots = await driver.waitForSnapshots(2);

    const values = snapshots
      .map((snapshot) => snapshot.nodes.find((node) => node.role === 'textbox')?.value)
      .filter((value) => value?.status === 'known')
      .map((value) => value!.status === 'known' ? value!.value : '');

    // The app types into the field on every step; at least one snapshot has to
    // show a value it set, or the probe is reporting a stale tree.
    expect(values.some((value) => value.startsWith('typed'))).toBe(true);
  }, 60_000);

  it('follows observable selection and scroll state', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    await launchInstrumented({ driver, steps: 3 });
    const snapshots = await driver.waitForSnapshots(2);

    const selectedPositions = snapshots
      .map((snapshot) => snapshot.nodes.find((node) => node.role === 'list')?.state?.positionInSet)
      .filter((position): position is number => position !== undefined);
    // Select exposes a highlighted index. ScrollBox's private offset/extent are
    // retained in probe IR diagnostics, but do not become portable scroll
    // truth without an explicit scroll-state producer including its viewport.
    expect(new Set(selectedPositions).size).toBeGreaterThan(1);
    expect(snapshots.some((snapshot) => snapshot.nodes.some(
      (node) => node.frameworkType === 'ScrollBoxRenderable' && node.scroll !== undefined,
    ))).toBe(false);
  }, 60_000);

  it('marks each revision it published, and the markers verify', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    const result = await launchInstrumented({ driver, steps: 2 });
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

    const instrumented = await launchInstrumented({ driver, steps: 2 });
    const vanilla = await launch({ steps: 2 });

    expect(instrumented.code).toBe(0);
    expect(vanilla.code).toBe(0);
    expect(instrumented.stderr).toBe(vanilla.stderr);
    expect(vanilla.stdout).not.toContain(MARKER_OSC_PREFIX);
    expect(instrumented.stdout.replaceAll(markerPattern(), '')).toBe(vanilla.stdout);
  }, 90_000);

  it('preserves the application-visible stdout identity', async () => {
    const driver = await startFakeDriver();
    open.push(driver);

    const instrumented = await launchInstrumented({
      driver,
      steps: 1,
      captureOracle: true,
      fixtureEnv: { TW_STDOUT_IDENTITY_ORACLE: '1' },
    });
    const vanilla = await launch({
      steps: 1,
      captureOracle: true,
      fixtureEnv: { TW_STDOUT_IDENTITY_ORACLE: '1' },
    });

    expect(JSON.parse(instrumented.oracle)).toEqual({ stdoutIsProcessStdout: true });
    expect(instrumented.oracle).toBe(vanilla.oracle);
  }, 90_000);

  it('leaves an application-owned custom stdout on the vanilla path', async () => {
    const driver = await startFakeDriver();
    open.push(driver);
    const fixtureEnv = { TW_CUSTOM_STDOUT: '1' };

    const instrumented = await launchInstrumented({ driver, steps: 2, fixtureEnv });
    const vanilla = await launch({ steps: 2, fixtureEnv });

    expect(instrumented.stderr).toBe(vanilla.stderr);
    expect(instrumented.stdout).toBe(vanilla.stdout);
    expect(instrumented.stdout).not.toContain(MARKER_OSC_PREFIX);
  }, 90_000);

  it('preserves a stdout.write wrapper captured before renderer creation', async () => {
    const driver = await startFakeDriver();
    open.push(driver);
    const fixtureEnv = { TW_WRAP_STDOUT_WRITE: '1' };

    const instrumented = await launchInstrumented({
      driver, steps: 2, fixtureEnv, captureOracle: true,
    });
    const vanilla = await launch({ steps: 2, fixtureEnv, captureOracle: true });
    const parseOracle = (value: string): Array<Record<string, unknown>> => value
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    const instrumentedOracle = parseOracle(instrumented.oracle);
    const vanillaOracle = parseOracle(vanilla.oracle);

    expect(instrumentedOracle[0]).toEqual({ rendererCapturedWrapper: true });
    expect(instrumentedOracle[1]?.['wrapperRestoredAfterDestroy']).toBe(true);
    expect(instrumentedOracle.map((record) => record['rendererCapturedWrapper'] ?? record['wrapperRestoredAfterDestroy']))
      .toEqual(vanillaOracle.map((record) => record['rendererCapturedWrapper'] ?? record['wrapperRestoredAfterDestroy']));
    expect(instrumented.stdout.replaceAll(markerPattern(), '')).toBe(vanilla.stdout);
  }, 90_000);

  it('preserves vanilla bytes through remote auto-detection', async () => {
    const driver = await startFakeDriver();
    open.push(driver);
    const fixtureEnv = { SSH_CONNECTION: '192.0.2.1 50000 192.0.2.2 22' };

    const instrumented = await launchInstrumented({ driver, steps: 2, fixtureEnv });
    const vanilla = await launch({ steps: 2, fixtureEnv });

    expect(instrumented.stderr).toBe(vanilla.stderr);
    expect(instrumented.stdout.replaceAll(markerPattern(), '')).toBe(vanilla.stdout);
  }, 90_000);

  it('publishes qualified v2 geometry and the native exact hit grid', async () => {
    const driver = await startFakeDriver();
    open.push(driver);
    await launchInstrumented({ driver, steps: 2 });
    const hello = await driver.waitForHandshake();
    expect(hello.protocol).toBe(PROTOCOL_ID);
    expect(hello.capabilities).toContain('pointer-hit-grid');
    expect(hello.capabilities).toContain('clipped-geometry');
    expect(hello.probe?.capabilities).toContain('visible-rect');
    const [snapshot] = await driver.waitForSnapshots(1);
    expect(snapshot?.v).toBe(2);
    expect(snapshot?.coordinateSpace).toMatchObject({ status: 'known', value: 'viewport-cells' });
    expect(snapshot?.hitGrid).toMatchObject({ status: 'known' });
    expect(snapshot?.nodes.some((node) => node.geometry?.intendedRect.status === 'known')).toBe(true);
    expect(snapshot?.nodes.every((node) =>
      node.geometry?.visibleRect.status === 'known' || node.geometry?.visibleRect.status === 'absent')).toBe(true);
    expect(snapshot?.nodes.every((node) => node.geometry !== undefined)).toBe(true);
  }, 60_000);

  it('records nested clips, overlap ownership, hidden nodes, render hooks and resize from real OpenTUI', async () => {
    const driver = await startFakeDriver();
    open.push(driver);
    let child: ChildProcess | undefined;
    let destroySent = false;
    const resultPromise = launchInstrumented({
      driver,
      appPath: geometryApp,
      controlled: true,
      onSpawn: (spawned) => { child = spawned; },
    });
    const control = child?.stdin;
    if (control === undefined || control === null) {
      child?.kill();
      await resultPromise.catch(() => undefined);
      throw new Error('controlled OpenTUI geometry fixture has no stdin');
    }
    let snapshot: FakeDriver['snapshots'][number] | undefined;
    let resized: FakeDriver['snapshots'][number] | undefined;
    let interactionFailure: unknown;
    let result: Run | undefined;
    try {
      snapshot = await driver.waitForSnapshot(
        (candidate) => candidate.nodes.some((node) => node.name === 'nested clipped target'),
        'initial geometry snapshot',
      );
      expect({columns: snapshot.columns, rows: snapshot.rows}).not.toEqual({columns: 40, rows: 12});
      control.write('resize\n');
      resized = await driver.waitForSnapshot(
        (candidate) => candidate.columns === 40 && candidate.rows === 12,
        '40x12 resized geometry snapshot',
      );
      destroySent = true;
      control.end('destroy\n');
    } catch (error) {
      interactionFailure = error;
    } finally {
      if (!destroySent) control.end('destroy\n');
      try {
        result = await resultPromise;
      } catch (processFailure) {
        if (interactionFailure !== undefined) {
          throw new AggregateError(
            [interactionFailure, processFailure],
            'OpenTUI geometry interaction and fixture teardown both failed',
          );
        }
        throw processFailure;
      }
    }
    if (interactionFailure !== undefined) throw interactionFailure;
    if (snapshot === undefined || resized === undefined || result === undefined) {
      throw new Error('OpenTUI geometry fixture completed without causal snapshot evidence');
    }
    expect(result.stderr).toBe('');
    const clipped = snapshot.nodes.find((node) => node.name === 'nested clipped target')!;
    const hidden = snapshot.nodes.find((node) => node.name === 'hidden node')!;
    const moved = snapshot.nodes.find((node) => node.name === 'hook moved')!;
    const upper = snapshot.nodes.find((node) => node.name === 'upper overlap')!;

    expect(clipped.geometry.intendedRect).toMatchObject({ status: 'known' });
    expect(clipped.geometry.visibleRect).toMatchObject({ status: 'known' });
    if (clipped.geometry.intendedRect.status === 'known' && clipped.geometry.visibleRect.status === 'known') {
      expect(clipped.geometry.visibleRect.value.width).toBeLessThan(clipped.geometry.intendedRect.value.width);
    }
    expect(hidden.geometry).toMatchObject({
      displayed: { status: 'known', value: false },
      visibleRect: { status: 'absent', reason: 'not-displayed' },
    });
    expect(moved.geometry.intendedRect).toMatchObject({ status: 'known' });
    expect(snapshot.hitGrid).toMatchObject({ status: 'known' });
    if (snapshot.hitGrid.status === 'known' && upper.geometry.visibleRect.status === 'known') {
      const { row, column } = upper.geometry.visibleRect.value;
      expect(snapshot.hitGrid.value.regions.some((region) =>
        region.recipientId === upper.id
        && region.rect.row === row
        && column >= region.rect.column
        && column < region.rect.column + region.rect.width)).toBe(true);
    }
    expect({columns: resized.columns, rows: resized.rows}).toEqual({columns: 40, rows: 12});
    expect(resized.revision).toBeGreaterThan(snapshot.revision);
  }, 60_000);

  it('runtime-observes custom, buffered, scrolling and dynamic frames', async () => {
    const driver = await startFakeDriver();
    open.push(driver);
    let child: ChildProcess | undefined;
    const resultPromise = launchInstrumented({
      driver,
      appPath: runtimeConformanceApp,
      controlled: true,
      onSpawn: (spawned) => { child = spawned; },
      fixtureEnv: {
        TW_RUNTIME_CONTROLLED_LIFECYCLE: '1',
      },
    });
    try {
      await driver.waitForSnapshots(3);
    } finally {
      child?.stdin?.end('stop\n');
    }
    const result = await resultPromise;
    expect(result.stderr).toBe('');

    const snapshots = driver.snapshots;
    expect(driver.errors).toEqual([]);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots.some((snapshot) => snapshot.nodes.some(
      (node) => node.frameworkType === 'NoHitGridRenderable',
    ))).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.nodes.some(
      (node) => node.frameworkType === 'LocalBufferScissorRenderable',
    ))).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.nodes.some(
      (node) => node.name === 'dynamic mounted',
    ))).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.nodes.every(
      (node) => node.name !== 'dynamic mounted',
    ))).toBe(true);
    const revisions = snapshots.map((snapshot) => snapshot.revision);
    expect(revisions).toEqual([...revisions].sort((left, right) => left - right));
    expect(new Set(revisions).size).toBe(revisions.length);
    const scrolledRow = snapshots.flatMap((snapshot) => snapshot.nodes).filter(
      (node) => node.name === 'differential row 7',
    );
    expect(scrolledRow.some((node) => node.geometry.visibleRect.status === 'known'
      && node.geometry.visibleRect.value.width > 0
      && node.geometry.visibleRect.value.height > 0)).toBe(true);
    expect(snapshots.some((snapshot) => {
      const upper = snapshot.nodes.find((node) => node.name === 'upper overlap');
      return upper !== undefined && snapshot.hitGrid.status === 'known'
        && snapshot.hitGrid.value.regions.some((region) => region.recipientId === upper.id);
    })).toBe(true);
    expect(new Set(snapshots.map((snapshot) => `${snapshot.columns}x${snapshot.rows}`)).size).toBeGreaterThan(1);
  }, 60_000);

  it('uses the certified same-pass renderOffset in split-footer mode', async () => {
    const driver = await startFakeDriver();
    open.push(driver);
    let child: ChildProcess | undefined;
    const resultPromise = launchInstrumented({
      driver,
      appPath: runtimeConformanceApp,
      controlled: true,
      captureOracle: true,
      onSpawn: (spawned) => { child = spawned; },
      fixtureEnv: {
        TW_RUNTIME_SPLIT_FOOTER: '1',
        TW_RUNTIME_CONTROLLED_LIFECYCLE: '1',
        TW_RUNTIME_ORACLE_FD: '3',
      },
    });
    try {
      await driver.waitForSnapshots(4);
    } finally {
      child?.stdin?.end('stop\n');
    }
    const result = await resultPromise;
    expect(result.stderr).toBe('');
    expect(driver.errors).toEqual([]);
    const oracleByToken = new Map(
      result.oracle.trim().split('\n').filter(Boolean).map((line) => {
        const record = JSON.parse(line) as { frameId: number; renderOffset: number; token: string };
        return [record.token, record] as const;
      }),
    );
    const matchedOrigins: number[] = [];
    for (const snapshot of driver.snapshots) {
      const oracleNode = snapshot.nodes.find((node) => node.name?.startsWith('split origin oracle '));
      const oracle = oracleNode?.name === undefined ? undefined : oracleByToken.get(oracleNode.name);
      expect(oracle).toBeDefined();
      if (oracle === undefined) continue;
      const noHit = snapshot.nodes.find((node) => node.frameworkType === 'NoHitGridRenderable');
      expect(noHit?.geometry.intendedRect.status).toBe('known');
      if (noHit?.geometry.intendedRect.status !== 'known') continue;
      // NoHitGridRenderable has an invariant surface-local top of 1. Its
      // terminal-space row therefore independently exposes the committed
      // native surface origin for cross-checking every other observation.
      const origin = noHit.geometry.intendedRect.value.row - 1;
      matchedOrigins.push(origin);
      expect(origin).toBe(oracle.renderOffset);
      expect(noHit?.geometry.intendedRect).toMatchObject({
        status: 'known', value: { row: origin + 1, column: 31, width: 9, height: 2 },
      });
      expect(noHit?.geometry.visibleRect).toMatchObject({
        status: 'known', value: { row: origin + 1, column: 31, width: 9, height: 2 },
      });
      const clipped = snapshot.nodes.find((node) => node.name === 'differential clipped');
      expect(clipped?.geometry.intendedRect).toMatchObject({
        status: 'known', value: { row: origin + 2, column: 6, width: 20, height: 1 },
      });
      expect(clipped?.geometry.visibleRect).toMatchObject({
        status: 'known', value: { row: origin + 2, column: 6, width: 7, height: 1 },
      });
      const upper = snapshot.nodes.find((node) => node.name === 'upper overlap');
      expect(upper?.geometry.visibleRect).toMatchObject({
        status: 'known', value: { row: origin + 7, column: 21, width: 8, height: 1 },
      });
      expect(snapshot.hitGrid.status).toBe('known');
      if (snapshot.hitGrid.status === 'known' && upper !== undefined) {
        expect(snapshot.hitGrid.value.regions).toContainEqual({
          recipientId: upper.id,
          rect: { row: origin + 7, column: 21, width: 8, height: 1 },
        });
      }
    }
    expect(matchedOrigins.length).toBeGreaterThanOrEqual(4);
    expect(new Set(matchedOrigins).size).toBe(matchedOrigins.length);
  }, 60_000);

  it('keeps split-footer terminal bytes identical apart from commit markers', async () => {
    const driver = await startFakeDriver();
    open.push(driver);
    const fixtureEnv = { TW_RUNTIME_SPLIT_FOOTER: '1' };

    const instrumented = await launchInstrumented({
      driver,
      appPath: runtimeConformanceApp,
      fixtureEnv,
    });
    const vanilla = await launch({ appPath: runtimeConformanceApp, fixtureEnv });

    expect(instrumented.stderr).toBe(vanilla.stderr);
    expect(instrumented.stdout.replaceAll(markerPattern(), '')).toBe(vanilla.stdout);
  }, 90_000);
});
