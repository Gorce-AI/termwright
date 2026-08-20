/** Level C: a normal `ink.render` application becomes observable by launch only. */

import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ENV_ENDPOINT,
  ENV_PROTOCOL,
  ENV_TOKEN,
  MARKER_OSC_CODE,
  MARKER_OSC_PREFIX,
  PROTOCOL_V2_ID,
  verifyMarkerPayload,
} from '@termwright/protocol';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(packageRoot, 'src', 'testing', 'vanilla-app.mjs');
const annotatedApp = join(packageRoot, 'src', 'testing', 'annotated-app.mjs');
const annotationSdkRoot = join(packageRoot, '..', 'ink');

type Runtime = 'bun' | 'node';

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

type BuiltWithProbe = (
  runtime: Runtime,
  argv: readonly string[],
) => { readonly command: readonly string[] };

let builtWithProbe: BuiltWithProbe | undefined;

function bunAvailable(): boolean {
  return spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0;
}

function launch(options: {
  readonly runtime: Runtime;
  readonly mode: 'vanilla' | 'dormant' | 'instrumented' | 'faulted';
  readonly driver?: FakeDriver;
  readonly steps?: number;
  readonly appPath?: string;
  readonly protocol?: typeof PROTOCOL_V2_ID;
}): Promise<Run> {
  const interpreter = options.runtime === 'bun' ? 'bun' : process.execPath;
  const base = [interpreter, options.appPath ?? app];
  const command = options.mode === 'vanilla'
    ? base
    : builtWithProbe?.(options.runtime, base).command;
  if (command === undefined) throw new Error('probe package was not built before launch');
  const [executable, ...argv] = command as [string, ...string[]];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, {
      cwd: packageRoot,
      env: {
        ...process.env,
        TW_APP_STEPS: String(options.steps ?? 2),
        [ENV_PROTOCOL]: options.protocol ?? '',
        ...(options.mode === 'instrumented'
          ? {
              [ENV_ENDPOINT]: options.driver?.endpoint as string,
              [ENV_TOKEN]: options.driver?.token as string,
            }
          : options.mode === 'faulted'
            ? { [ENV_ENDPOINT]: join(packageRoot, 'missing.sock'), [ENV_TOKEN]: 'fault-token' }
            : { [ENV_ENDPOINT]: '', [ENV_TOKEN]: '' }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
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

/** Node warnings contain the child pid, which necessarily differs per run. */
function stableStderr(value: string): string {
  return value.replace(/^\(node:\d+\)(?= ExperimentalWarning:)/gmu, '(node:PID)');
}

describe('the fixture premise', () => {
  it('imports React and Ink only, and uses normal ink.render', async () => {
    const source = await readFile(app, 'utf8');
    expect(source).toContain("from 'react'");
    expect(source).toContain("from 'ink'");
    expect(source).toContain('render(React.createElement(App)');
    expect(source).not.toContain('@termwright');
  });
});

describe('a vanilla Ink app instrumented by the launcher', () => {
  const open: FakeDriver[] = [];
  const runtimes: readonly Runtime[] = bunAvailable() ? ['node', 'bun'] : ['node'];

  beforeAll(async () => {
    // Process tests execute published JavaScript, not Vitest's source transform.
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      execFile('npm', ['run', 'build'], { cwd: annotationSdkRoot }, (error) => {
        if (error === null) resolve();
        else reject(error);
      });
    });
    await new Promise<void>((resolve, reject) => {
      execFile('npm', ['run', 'build'], { cwd: packageRoot }, (error) => {
        if (error === null) resolve();
        else reject(error);
      });
    });
    const built = await import(join(packageRoot, 'dist', 'index.js')) as {
      readonly withProbe: BuiltWithProbe;
    };
    builtWithProbe = built.withProbe;
  }, 180_000);

  afterEach(async () => {
    for (const driver of open.splice(0)) await driver.close();
  });

  it.each(runtimes)(
    'publishes an explicit qualified v2 contract under %s',
    async (runtime) => {
      const driver = await startFakeDriver();
      open.push(driver);
      await launch({ runtime, mode: 'instrumented', driver, protocol: PROTOCOL_V2_ID });
      const hello = await driver.waitForHandshake();
      const [snapshot] = await driver.waitForSnapshots(1);
      expect(hello.protocol).toBe(PROTOCOL_V2_ID);
      expect(hello.capabilities).toContain('qualified-observations');
      expect(snapshot?.v).toBe(2);
      expect(snapshot?.coordinateSpace).toMatchObject({ status: 'known', value: 'viewport-cells' });
      expect(snapshot?.hitGrid).toMatchObject({ status: 'unsupported' });
      expect(snapshot?.nodes.every((node) => node.geometry !== undefined)).toBe(true);
      expect(snapshot?.nodes.some((node) => node.geometry?.visibleRect.status === 'unsupported')).toBe(true);
    },
    60_000,
  );

  it.each(runtimes)(
    'merges optional SDK intent with retained physical facts under %s',
    async (runtime) => {
      const driver = await startFakeDriver();
      open.push(driver);
      await launch({ runtime, mode: 'instrumented', driver, appPath: annotatedApp });
      const hello = await driver.waitForHandshake();
      const [snapshot] = await driver.waitForSnapshots(1);
      const deploy = snapshot?.nodes.find((node) => node.testId === 'deploy-production');
      const label = snapshot?.nodes.find((node) => node.testId === 'deploy-label');

      expect(deploy).toMatchObject({
        role: 'button',
        name: 'Deploy production',
        description: 'Starts the production deployment',
        state: { disabled: true },
        extended: { environment: 'production', retries: 2 },
        actions: ['activate'],
        labelledBy: [label?.id],
        describedBy: [label?.id],
        p: 'annotation',
        px: expect.objectContaining({ state: 'framework' }),
      });
      expect(hello.capabilities).toContain('actions');
      expect(deploy?.value).toBeUndefined();
    },
    60_000,
  );

  it.each(runtimes)(
    'handshakes with ProbeInfo and publishes every host under %s',
    async (runtime) => {
      const driver = await startFakeDriver();
      open.push(driver);
      const result = await launch({ runtime, mode: 'instrumented', driver, steps: 2 });
      expect(result.code).toBe(0);

      const hello = await driver.waitForHandshake();
      expect(hello.probe).toMatchObject({
        framework: 'ink',
        probeVersion: '0.1.0',
        identityKind: 'stable',
      });
      // No guessed frameworkVersion and no source-component claim: Ink's host
      // tree contains neither after reconciliation.
      expect(hello.probe?.frameworkVersion).toBeUndefined();

      const [snapshot] = await driver.waitForSnapshots(1);
      expect(snapshot?.nodes.map((node) => node.role)).toEqual(expect.arrayContaining([
        'application',
        'generic',
        'text',
        'button',
      ]));
      expect(snapshot?.nodes.find((node) => node.role === 'button')).toMatchObject({
        name: 'Approve',
        frameworkType: 'ink-box',
      });
      expect(snapshot?.nodes.every((node) => !node.frameworkType?.includes('App'))).toBe(true);
    },
    60_000,
  );

  it.each(runtimes)(
    'publishes live updates under %s',
    async (runtime) => {
      const driver = await startFakeDriver();
      open.push(driver);
      await launch({ runtime, mode: 'instrumented', driver, steps: 3 });
      const snapshots = await driver.waitForSnapshots(2);
      const values = snapshots.flatMap((snapshot) => snapshot.nodes
        .filter((node) => node.role === 'text' && node.name.startsWith('Count '))
        .map((node) => node.name));
      expect(new Set(values).size).toBeGreaterThan(1);
    },
    60_000,
  );

  it.each(runtimes)(
    'emits verifiable revision markers under %s',
    async (runtime) => {
      const driver = await startFakeDriver();
      open.push(driver);
      const result = await launch({ runtime, mode: 'instrumented', driver });
      const snapshots = await driver.waitForSnapshots(1);
      const markers = [...result.stdout.matchAll(markerPattern())]
        .map((match) => verifyMarkerPayload(
          match[1] as string,
          driver.token,
          driver.sessionId,
        ))
        .filter((marker) => marker !== null);
      expect(markers.length).toBeGreaterThan(0);
      expect(markers.map((marker) => marker?.revision)).toEqual(expect.arrayContaining(
        snapshots.map((snapshot) => snapshot.revision),
      ));
    },
    60_000,
  );

  it.each(runtimes)(
    'is byte-identical when dormant under %s',
    async (runtime) => {
      const vanilla = await launch({ runtime, mode: 'vanilla' });
      const dormant = await launch({ runtime, mode: 'dormant' });
      expect(dormant.code).toBe(vanilla.code);
      expect(dormant.stdout).toBe(vanilla.stdout);
      expect(stableStderr(dormant.stderr)).toBe(stableStderr(vanilla.stderr));
      expect(dormant.stdout).not.toContain(MARKER_OSC_PREFIX);
    },
    60_000,
  );

  it.each(runtimes)(
    'isolates an unreachable driver under %s',
    async (runtime) => {
      const vanilla = await launch({ runtime, mode: 'vanilla' });
      const faulted = await launch({ runtime, mode: 'faulted' });
      expect(faulted.code).toBe(vanilla.code);
      expect(faulted.stdout).toBe(vanilla.stdout);
      expect(stableStderr(faulted.stderr)).toBe(stableStderr(vanilla.stderr));
    },
    60_000,
  );

  it.each(runtimes)(
    'changes application bytes only by authenticated markers under %s',
    async (runtime) => {
      const driver = await startFakeDriver();
      open.push(driver);
      const instrumented = await launch({ runtime, mode: 'instrumented', driver });
      const vanilla = await launch({ runtime, mode: 'vanilla' });
      expect(instrumented.code).toBe(0);
      expect(stableStderr(instrumented.stderr)).toBe(stableStderr(vanilla.stderr));
      expect(instrumented.stdout.replaceAll(markerPattern(), '')).toBe(vanilla.stdout);
    },
    60_000,
  );
});
