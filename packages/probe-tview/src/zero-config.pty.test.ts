import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect } from 'vitest';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import { launchTerminal, type TerminalHarness } from '@termwright/driver';
import {
  createNativePtyBackend,
  nativePtyAvailable,
  launchTerminalWithBackend,
  type PtyBackend,
  type PtyProcess,
} from '@termwright/driver/experimental';
import { goTestCapability } from '../../../scripts/test-support/go-toolchain.mjs';
import { compilerUnitTargetsForPlatform, prepareInstrumentedBuild } from './launch.js';

const it = resourceAwareIt.resources({ terminals: 1, traceWriters: 0, hostPressure: 'exclusive' });
const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'testing', 'fixture-app');
const CLIENT = join(here, '..', '..', '..', 'clients', 'go');
const PROBE_SOURCE = join(here, '..', 'assets', 'tview_probe.go.txt');

const hasGo = await goTestCapability(
  async () => {
    await run('go', ['version']);
    return true;
  },
  false,
  'Go certification toolchain',
);
const runnable = hasGo && nativePtyAvailable();
const roots: string[] = [];
const sessions: TerminalHarness[] = [];
const executableSuffix = process.platform === 'win32' ? '.exe' : '';

async function waitForPairedSemanticRevision(
  terminal: TerminalHarness,
  minimum: number,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  let checkpoint = terminal.checkpoint();
  for (;;) {
    if (
      checkpoint.semanticRevision !== null &&
      checkpoint.semanticRevision >= minimum &&
      checkpoint.pairedScreenRevision !== null
    ) {
      return;
    }
    checkpoint = await terminal.waitForCheckpointChange({
      after: checkpoint,
      timeout: Math.max(0, deadline - performance.now()),
    });
  }
}

afterEach(async () => {
  const owned = sessions.splice(0);
  const ownedRoots = roots.splice(0);
  // Windows keeps a running executable locked. Reap the PTY process before
  // deleting its build root; collect both phases so a close failure cannot
  // suppress cleanup evidence.
  const closed = await Promise.allSettled(owned.map((session) => session.close()));
  const removed = await Promise.allSettled(
    ownedRoots.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  const results = [...closed, ...removed];
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, 'failed to clean test-owned tview resources');
  }
});

async function fixture(options: {
  readonly instrumented: boolean;
  readonly linkedModule?: boolean;
  readonly vendor?: boolean;
}): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-tview-t1-')));
  roots.push(dir);
  const app = join(dir, 'app');
  await mkdir(app, { recursive: true });
  await cp(FIXTURE, app, { recursive: true });
  await run(
    'go',
    ['mod', 'edit', `-replace=github.com/gorce-ai/termwright/clients/go=${await realpath(CLIENT)}`],
    { cwd: app },
  );
  await run('go', ['mod', 'tidy'], { cwd: app });
  if (options.vendor) await run('go', ['mod', 'vendor'], { cwd: app });

  const moduleDir = options.linkedModule ? join(dir, 'app-alias') : app;
  if (options.linkedModule) {
    await symlink(app, moduleDir, process.platform === 'win32' ? 'junction' : 'dir');
  }

  const binary = join(dir, `app-binary${executableSuffix}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.vendor
      ? {
          GOFLAGS: '-mod=vendor',
        }
      : {}),
  };
  const prepared = options.instrumented
    ? await prepareInstrumentedBuild({ moduleDir, outputDir: join(dir, 'tool'), env })
    : null;
  if (options.linkedModule) {
    expect(prepared?.moduleDir).toBe(await realpath(app));
    expect(prepared?.env.PWD).toBe(prepared?.moduleDir);
  }
  const args = ['build', ...(prepared?.goArgs ?? []), '-o', binary, '.'];
  await run('go', args, { cwd: prepared?.moduleDir ?? moduleDir, env: prepared?.env ?? env });
  return binary;
}

interface ByteCapture {
  readonly allBytes: () => Buffer;
  readonly backend: PtyBackend;
  readonly transaction: (begin: string, end: string) => Buffer;
  readonly waitFor: (boundary: string) => Promise<void>;
}

function byteCapturingBackend(): ByteCapture {
  const upstream = createNativePtyBackend();
  const chunks: Buffer[] = [];
  let exitError: Error | undefined;
  const waiters = new Set<{
    readonly boundary: Buffer;
    readonly reject: (error: Error) => void;
    readonly resolve: () => void;
  }>();
  const captured = (): Buffer => Buffer.concat(chunks);
  const settleBoundaries = (): void => {
    const bytes = captured();
    for (const waiter of waiters) {
      if (bytes.indexOf(waiter.boundary) < 0) continue;
      waiters.delete(waiter);
      waiter.resolve();
    }
  };
  const waitFor = async (boundary: string): Promise<void> => {
    const encoded = Buffer.from(boundary);
    if (captured().indexOf(encoded) >= 0) return;
    if (exitError !== undefined) throw exitError;
    await new Promise<void>((resolve, reject) =>
      waiters.add({ boundary: encoded, resolve, reject }),
    );
  };
  return {
    allBytes: captured,
    waitFor,
    transaction(begin, end): Buffer {
      const bytes = captured();
      const encodedBegin = Buffer.from(begin);
      const encodedEnd = Buffer.from(end);
      const start = bytes.indexOf(encodedBegin);
      if (start < 0)
        throw new Error(`tview transaction begin was not observed: ${JSON.stringify(begin)}`);
      const endOffset = bytes.indexOf(encodedEnd, start + encodedBegin.length);
      if (endOffset < 0)
        throw new Error(`tview transaction end was not observed: ${JSON.stringify(end)}`);
      return bytes.subarray(start + encodedBegin.length, endOffset);
    },
    backend: {
      name: `${upstream.name}+capture`,
      spawn(options): PtyProcess {
        const process = upstream.spawn({
          ...options,
          env: { ...options.env, TERMWRIGHT_ENDPOINT: '', TERMWRIGHT_TOKEN: '' },
        });
        const listeners = new Set<(data: Uint8Array) => void>();
        const pending: Uint8Array[] = [];
        process.onData((data) => {
          const copy = Buffer.from(data);
          chunks.push(copy);
          settleBoundaries();
          if (listeners.size === 0) pending.push(copy);
          else for (const listener of listeners) listener(copy);
        });
        process.onExit((status) => {
          exitError = new Error(
            `tview fixture exited before its causal output boundary (code=${String(status.code)}, signal=${String(status.signal)})`,
          );
          for (const waiter of waiters) waiter.reject(exitError);
          waiters.clear();
        });
        return {
          get pid() {
            return process.pid;
          },
          write: (data) => process.write(data),
          resize: (columns, rows) => process.resize(columns, rows),
          signal: (signal) => process.signal(signal),
          dispose: () => process.dispose(),
          onExit: (listener) => process.onExit(listener),
          onData(listener) {
            listeners.add(listener);
            for (const data of pending.splice(0)) listener(data);
            return () => listeners.delete(listener);
          },
        };
      },
    },
  };
}

function syncBoundary(redraw: number, phase: 'begin' | 'end'): string {
  return `\u001b]8488;termwright-tview-fixture-sync:${redraw}:${phase}\u0007`;
}

describe.skipIf(!runnable)('tview T0+T1 injection', () => {
  it('applies the add-only unit and publishes the retained tree after Show', async () => {
    const binary = await fixture({ instrumented: true, linkedModule: true });
    const app = await launchTerminal({ command: [binary], columns: 80, rows: 24 });
    sessions.push(app);
    await app.waitForText('readme.md');
    await waitForPairedSemanticRevision(app, 1);
    expect(app.semanticTree()?.v).toBe(2);
    expect(await app.getByRole('list', { name: 'Files' }).count()).toBe(1);
    expect(await app.getByRole('button', { name: 'Save' }).count()).toBe(1);
    expect(app.contract()?.framework?.instrumentation).toEqual(
      expect.objectContaining({ highestTier: 'T1', semanticClass: 'A' }),
    );
    expect(app.contract()?.framework?.version).toBe('v0.42.0');
  }, 120_000);

  it('injects the same package unit in Go vendor mode', async () => {
    const binary = await fixture({ instrumented: true, vendor: true });
    const app = await launchTerminal({ command: [binary], columns: 80, rows: 24 });
    sessions.push(app);
    await app.waitForText('readme.md');
    await waitForPairedSemanticRevision(app, 1);
    expect(await app.getByRole('list', { name: 'Files' }).count()).toBe(1);
  }, 120_000);

  it('is byte-for-byte non-interfering for a causally bounded dormant transaction', async () => {
    const plain = await fixture({ instrumented: false });
    const injected = await fixture({ instrumented: true });
    const captures = [byteCapturingBackend(), byteCapturingBackend()];
    for (const [index, binary] of [plain, injected].entries()) {
      const app = await launchTerminalWithBackend({
        backend: captures[index]!.backend,
        command: [binary],
        columns: 80,
        rows: 24,
      });
      sessions.push(app);
      await app.waitForText('readme.md');
      expect(app.contract()?.framework ?? null).toBeNull();
      expect(app.semanticTree()).toBeNull();
      await app.press('r');
      await captures[index]!.waitFor(syncBoundary(1, 'end'));
      await app.press('r');
      await captures[index]!.waitFor(syncBoundary(2, 'end'));
      await app.press('q');
      expect(await app.waitForExit()).toMatchObject({ code: 0 });
      await app.close();
    }
    const reference = captures[0]!.transaction(syncBoundary(2, 'begin'), syncBoundary(2, 'end'));
    expect(reference.includes(Buffer.from('redraw:2'))).toBe(true);
    expect(reference.length).toBeGreaterThan(Buffer.byteLength('redraw:2'));
    expect(captures[1]!.transaction(syncBoundary(2, 'begin'), syncBoundary(2, 'end'))).toEqual(
      reference,
    );
    for (const capture of captures) {
      expect(capture.allBytes().includes(Buffer.from('\u001b]8487;'))).toBe(false);
    }
  }, 120_000);
});

it.skipIf(!hasGo)(
  'fails closed when an active build omitted compiler injection',
  async () => {
    const binary = await fixture({ instrumented: false });
    await expect(
      run(binary, [], {
        env: {
          ...process.env,
          TERMWRIGHT_ENDPOINT: '/definitely/missing/termwright.sock',
          TERMWRIGHT_TOKEN: 'active-but-not-injected',
        },
      }),
    ).rejects.toMatchObject({ code: 2 });
  },
  120_000,
);

it('uses one decorated Show boundary without a source mutation lifecycle seam', async () => {
  const source = await readFile(PROBE_SOURCE, 'utf8');
  expect(source).toContain('probehost.Register("tview"');
  expect(source).toContain('type termwrightScreen struct');
  expect(source).toContain('s.Screen.Show()\n\tphase := s.phase.Load()');
  expect(source).toContain('phase != termwrightPhaseIdle && !s.hooksIntact()');
  expect(source).toContain('s.phase.CompareAndSwap(termwrightPhaseFinal, termwrightPhaseIdle)');
  expect(source).toContain('decorated.beforeHook = decorated.beforeDraw');
  expect(source).toContain('decorated.afterHook = decorated.afterDraw');
  expect(source).toContain('s.commit(s.application.root, s.Screen)');
  expect(source).not.toContain('SetAfterDrawFunc');
  expect(source).not.toContain('termwrightFrameOrder');
  expect(source).not.toContain('termwrightBeforeRun');
  expect(source).not.toContain('a.updates');
  expect(source).toContain('underlying := a.screen');
  expect(source).toContain('a.screen = decorated');
  expect(source).not.toContain('time.Sleep(');
  expect(source).not.toContain('os.Stdout');
});

it('selects the Windows same-handle unit only for Windows compilers', () => {
  expect(compilerUnitTargetsForPlatform('linux')).toEqual(['zz_termwright_probe.go']);
  expect(compilerUnitTargetsForPlatform('darwin')).toEqual(['zz_termwright_probe.go']);
  expect(compilerUnitTargetsForPlatform('windows')).toEqual([
    'zz_termwright_probe.go',
    'zz_termwright_marker.go',
  ]);
});
