/**
 * The injection layer: can an application that imports nothing of ours end up
 * running our `createCliRenderer`?
 *
 * The unit tests pin the shim's guards. The process tests answer the actual
 * question, in both runtimes, against the real `@opentui/core` resolved from
 * this repo's store — which is the only way to catch the resolution traps the
 * Phase 0 audit found.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV_ENDPOINT, ENV_TOKEN } from '@termwright/protocol';
import { buildShimSource, originalUrl, shouldShim, toModuleUrl, ORIGINAL_MARKER } from './shim.js';
import { bunAvailable } from './testing/bun-available.js';
import { withProbe } from './launch.js';
import { isInstrumented } from './runtime.js';

const run = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(packageRoot, 'src', 'testing', 'zero-config-app.mjs');

/** Build once: the process tests need real `.js` entry points. */
async function ensureBuilt(): Promise<void> {
  const entry = join(packageRoot, 'dist', 'bun-preload.js');
  const built = await stat(entry).catch(() => null);
  if (built !== null) return;
  await run('npm', ['run', 'build'], { cwd: packageRoot });
}

interface Report {
  readonly runtime: string;
  readonly createCliRenderer: string;
  readonly wrapped: boolean;
  readonly renderable: string;
  readonly textRenderable: string;
  readonly boxRenderable: string;
}

describe('shim guards', () => {
  const entry = '/repo/node_modules/@opentui/core/index.bun.js';

  it('shims the entry of either build', () => {
    expect(shouldShim(entry)).toBe(true);
    expect(shouldShim('/repo/node_modules/@opentui/core/index.node.js')).toBe(true);
  });

  it('refuses to shim its own re-import', () => {
    // Without this the hook feeds itself; the pattern alone cannot tell the
    // difference, because the path still ends in the entry filename.
    expect(shouldShim(originalUrl(entry))).toBe(false);
    expect(originalUrl(entry)).toContain(ORIGINAL_MARKER);
  });

  it('leaves every other module alone', () => {
    expect(shouldShim('/repo/node_modules/@opentui/core/renderer.js')).toBe(false);
    expect(shouldShim('/repo/node_modules/ink/build/index.js')).toBe(false);
    expect(shouldShim('/app/index.node.js')).toBe(false);
  });

  it('keeps a query the loader already added', () => {
    expect(originalUrl(`${entry}?v=2`)).toBe(`${entry}?v=2&${ORIGINAL_MARKER}`);
  });

  it('echoes back the specifier form the loader handed over', () => {
    // Measured: a shim that re-imports through a file:// URL re-exports NOTHING
    // under Bun — one export instead of the framework's whole surface. So the
    // shim converts nothing; `toModuleUrl` exists for the launcher flag, where
    // Node needs a URL on Windows and Bun accepts one.
    expect(originalUrl('/repo/x.js')).toBe(`/repo/x.js?${ORIGINAL_MARKER}`);
    expect(originalUrl('file:///repo/x.js')).toBe(`file:///repo/x.js?${ORIGINAL_MARKER}`);
    expect(toModuleUrl('/repo/x.js')).toBe('file:///repo/x.js');
    expect(toModuleUrl('file:///repo/x.js')).toBe('file:///repo/x.js');
  });

  it('re-exports everything and shadows one name', () => {
    const source = buildShimSource(entry);
    expect(source).toContain('export * from');
    expect(source).toContain('export const createCliRenderer');
    // The wrapper must not be able to take the application down with it.
    expect(source).toContain('try {');
  });
});

describe('command building', () => {
  it('puts the Bun flag before the entry, where Bun accepts it', () => {
    const { command } = withProbe('bun', ['bun', 'app.ts']);
    expect(command[0]).toBe('bun');
    expect(command[1]).toBe('--preload');
    expect(command.at(-1)).toBe('app.ts');
  });

  it('uses --import for Node, because the probe is ESM', () => {
    const { command } = withProbe('node', ['node', 'app.mjs']);
    expect(command[1]).toBe('--import');
  });

  it.each(['bun', 'node'] as const)('passes the entry to %s as a file URL', (runtime) => {
    // A bare absolute path is fine until Windows, where `D:` reads as a URL
    // scheme and Node refuses it outright. Bun accepts either form, so one
    // form is used for both rather than a platform branch nobody exercises.
    const { command } = withProbe(runtime, [runtime, 'app']);
    expect(command[2]).toMatch(/^file:\/\//u);
  });

  it('refuses an empty command instead of producing a broken one', () => {
    expect(() => withProbe('node', [])).toThrowError();
  });
});

describe('dormant rule', () => {
  it('treats a process with no endpoint or token as uninstrumented', () => {
    expect(isInstrumented({})).toBe(false);
    expect(isInstrumented({ [ENV_ENDPOINT]: '/tmp/s.sock' })).toBe(false);
    expect(isInstrumented({ [ENV_TOKEN]: 'secret' })).toBe(false);
    expect(isInstrumented({ [ENV_ENDPOINT]: '', [ENV_TOKEN]: 'secret' })).toBe(false);
    expect(isInstrumented({ [ENV_ENDPOINT]: '/tmp/s.sock', [ENV_TOKEN]: 'secret' })).toBe(true);
  });
});

describe('a real application, in a real process', () => {
  let workDir: string;

  beforeAll(async () => {
    await ensureBuilt();
    workDir = await mkdtemp(join(tmpdir(), 'termwright-probe-'));
  }, 180_000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function launch(
    runtime: 'bun' | 'node',
    options: { readonly instrumented: boolean },
  ): Promise<Report> {
    const reportPath = join(workDir, `${runtime}-${options.instrumented}.json`);
    const interpreter = runtime === 'bun' ? 'bun' : process.execPath;
    const base = [interpreter, fixture];
    // The built entry points, not `PROBE_ENTRIES`: those resolve as siblings of
    // the running module, which is correct once the package is installed and
    // wrong under vitest, which runs `src`. The production resolution is
    // asserted separately below.
    const entry = pathToFileURL(
      join(packageRoot, 'dist', runtime === 'bun' ? 'bun-preload.js' : 'node-hook.js'),
    ).href;
    const flag = runtime === 'bun' ? '--preload' : '--import';
    const command = options.instrumented ? [interpreter, flag, entry, ...base.slice(1)] : base;

    await run(command[0] as string, command.slice(1), {
      // Inside the package, so the framework resolves from this repo's store
      // rather than from Bun's own install cache.
      cwd: packageRoot,
      env: {
        ...process.env,
        TW_PROBE_REPORT: reportPath,
        ...(options.instrumented
          ? { [ENV_ENDPOINT]: join(workDir, 'nope.sock'), [ENV_TOKEN]: 'test-token' }
          : { [ENV_ENDPOINT]: '', [ENV_TOKEN]: '' }),
      },
    });

    return JSON.parse(await readFile(reportPath, 'utf8')) as Report;
  }

  const runtimes = (bunAvailable() ? ['bun', 'node'] : ['node']) as readonly ('bun' | 'node')[];

  it.skipIf(bunAvailable())('skips the Bun arms because no bun binary is reachable', () => {
    // Present so a run without Bun says so out loud instead of quietly
    // covering half of what the suite claims to cover.
    expect(bunAvailable()).toBe(false);
  });

  it.each(runtimes)(
    'wraps createCliRenderer under %s without the app importing anything',
    async (runtime) => {
      const report = await launch(runtime, { instrumented: true });

      expect(report.runtime).toBe(runtime);
      expect(report.wrapped).toBe(true);
      expect(report.createCliRenderer).toBe('function');
    },
    60_000,
  );

  it.each(runtimes)(
    'forwards the rest of the module untouched under %s',
    async (runtime) => {
      const report = await launch(runtime, { instrumented: true });

      // `export *` is what keeps a version of OpenTUI that grows an export
      // working without us knowing about it.
      expect(report.renderable).toBe('function');
      expect(report.textRenderable).toBe('function');
      expect(report.boxRenderable).toBe('function');
    },
    60_000,
  );

  it('ships entry points that resolve to real files once built', async () => {
    // `withProbe` hands a launcher these paths; if they do not exist in the
    // published layout, zero-config fails at the only moment that matters.
    const built = (await import(join(packageRoot, 'dist', 'index.js'))) as {
      PROBE_ENTRIES: Record<'bun' | 'node', string>;
    };
    for (const runtime of ['bun', 'node'] as const) {
      await expect(stat(built.PROBE_ENTRIES[runtime])).resolves.toBeDefined();
    }
  });

  it.each(runtimes)(
    'installs nothing under %s when the process is not instrumented',
    async (runtime) => {
      const report = await launch(runtime, { instrumented: false });

      expect(report.createCliRenderer).toBe('function');
      expect(report.wrapped).toBe(false);
    },
    60_000,
  );
});
