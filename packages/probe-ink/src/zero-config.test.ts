/** Level C: a normal `ink.render` application becomes observable by launch only. */

import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ENV_ENDPOINT,
  ENV_TOKEN,
  MARKER_OSC_CODE,
  MARKER_OSC_PREFIX,
  PROTOCOL_ID,
  verifyMarkerPayload,
} from '@termwright/protocol';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';
import { PACKAGE_VERSION } from './version.js';
import { bunTestCapability } from '../../../scripts/test-support/bun-runtime.mjs';
import { requireImmutableBuildInputs } from '../../../scripts/test-support/immutable-build-inputs.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(packageRoot, 'src', 'testing', 'vanilla-app.mjs');
const annotatedApp = join(packageRoot, 'src', 'testing', 'annotated-app.mjs');

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
  return bunTestCapability(
    () => spawnSync('bun', ['--version'], { stdio: 'ignore', timeout: 30_000 }).status === 0,
  );
}

function launch(options: {
  readonly runtime: Runtime;
  readonly mode: 'vanilla' | 'dormant' | 'instrumented' | 'faulted';
  readonly driver?: FakeDriver;
  readonly steps?: number;
  readonly appPath?: string;
}): Promise<Run> {
  const interpreter = options.runtime === 'bun' ? 'bun' : process.execPath;
  const base = [interpreter, options.appPath ?? app];
  const command =
    options.mode === 'vanilla' ? base : builtWithProbe?.(options.runtime, base).command;
  if (command === undefined) throw new Error('probe package was not built before launch');
  const [executable, ...argv] = command as [string, ...string[]];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, {
      cwd: packageRoot,
      env: {
        ...process.env,
        TW_APP_STEPS: String(options.steps ?? 2),
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

async function launchInstrumented(
  options: Omit<Parameters<typeof launch>[0], 'mode'>,
): Promise<Run> {
  const result = await launch({ ...options, mode: 'instrumented' });
  if (result.code !== 0) {
    throw new Error(
      `instrumented ${options.runtime} application exited with ${String(result.code)} before probe evidence: ` +
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
    // The native host consumes the already-built workspace just like a packed
    // installation. Building here used `tsup --clean` against shared `dist/`
    // directories and could delete the Ink preload while another project was
    // spawning it. Build is a host prerequisite, never a concurrent test-side
    // mutation of another attempt's executable inputs.
    const entry = join(packageRoot, 'dist', 'index.js');
    await requireImmutableBuildInputs(
      [
        entry,
        join(packageRoot, 'dist', 'bun-preload.js'),
        join(packageRoot, 'dist', 'node-hook.js'),
      ],
      {
        label: '@termwright/probe-ink zero-config tests',
        buildCommand: 'pnpm --filter @termwright/probe-ink build',
      },
    );
    const built = (await import(entry)) as {
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
      await launchInstrumented({ runtime, driver });
      const hello = await driver.waitForHandshake();
      const [snapshot] = await driver.waitForSnapshots(1);
      expect(hello.protocol).toBe(PROTOCOL_ID);
      expect(snapshot?.v).toBe(2);
      expect(snapshot?.coordinateSpace).toMatchObject({ status: 'known', value: 'viewport-cells' });
      expect(snapshot?.hitGrid).toMatchObject({ status: 'unsupported' });
      expect(snapshot?.nodes.every((node) => node.geometry !== undefined)).toBe(true);
      expect(
        snapshot?.nodes.every(
          (node) =>
            node.geometry.visibleRect.status === 'known' ||
            node.geometry.visibleRect.status === 'unsupported',
        ),
      ).toBe(true);
    },
    60_000,
  );

  it.each(runtimes)(
    'merges optional SDK intent with retained physical facts under %s',
    async (runtime) => {
      const driver = await startFakeDriver();
      open.push(driver);
      await launchInstrumented({ runtime, driver, appPath: annotatedApp });
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
      const result = await launchInstrumented({ runtime, driver, steps: 2 });
      expect(result.code).toBe(0);

      const hello = await driver.waitForHandshake();
      expect(hello.probe).toMatchObject({
        framework: 'ink',
        probeVersion: PACKAGE_VERSION,
        identityKind: 'stable',
      });
      // The framework version is certified from both checksummed artifacts,
      // not guessed from the retained host tree.
      expect(hello.probe?.frameworkVersion).toBe('7.1.1');

      const [snapshot] = await driver.waitForSnapshots(1);
      expect(snapshot?.nodes.map((node) => node.role)).toEqual(
        expect.arrayContaining(['application', 'generic', 'text', 'button']),
      );
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
      await launchInstrumented({ runtime, driver, steps: 3 });
      const snapshots = await driver.waitForSnapshots(2);
      const values = snapshots.flatMap((snapshot) =>
        snapshot.nodes
          .filter((node) => node.role === 'text' && node.name.startsWith('Count '))
          .map((node) => node.name),
      );
      expect(new Set(values).size).toBeGreaterThan(1);
    },
    60_000,
  );

  it.each(runtimes)(
    'emits verifiable revision markers under %s',
    async (runtime) => {
      const driver = await startFakeDriver();
      open.push(driver);
      const result = await launchInstrumented({ runtime, driver });
      const snapshots = await driver.waitForSnapshots(1);
      const markers = [...result.stdout.matchAll(markerPattern())]
        .map((match) => verifyMarkerPayload(match[1] as string, driver.token, driver.sessionId))
        .filter((marker) => marker !== null);
      expect(markers.length).toBeGreaterThan(0);
      expect(markers.map((marker) => marker?.revision)).toEqual(
        expect.arrayContaining(snapshots.map((snapshot) => snapshot.revision)),
      );
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
      const instrumented = await launchInstrumented({ runtime, driver });
      const vanilla = await launch({ runtime, mode: 'vanilla' });
      expect(instrumented.code).toBe(0);
      expect(stableStderr(instrumented.stderr)).toBe(stableStderr(vanilla.stderr));
      expect(instrumented.stdout.replaceAll(markerPattern(), '')).toBe(vanilla.stdout);
    },
    60_000,
  );
});
