import { describe, expect, it, vi } from 'vitest';
import {
  TermwrightPreflightError,
  preflightTestHost,
  type TermwrightPreflightDeps,
} from './preflight.js';

const GIB = 1024n * 1024n * 1024n;

describe('native host preflight', () => {
  it('fails early with the available and required disk space', async () => {
    const deps = fakeDeps({ freeBytes: 128n * 1024n * 1024n });
    await expect(preflightTestHost(input(), deps)).rejects.toMatchObject({
      code: 'TW_HOST_PREFLIGHT',
      message: expect.stringMatching(/insufficient free disk space[\s\S]*128 MiB[\s\S]*1 GiB/u),
    });
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it('names a missing required toolchain and the command that failed', async () => {
    const missing = Object.assign(new Error('spawn go ENOENT'), { code: 'ENOENT' });
    const deps = fakeDeps({ exec: async () => { throw missing; } });
    await expect(preflightTestHost(input({
      requiredToolchains: [{ name: 'Go', commands: [['go', 'version']] }],
    }), deps)).rejects.toThrow(/required toolchain "Go" is unavailable \(go version: ENOENT: spawn go ENOENT\)/u);
  });

  it('accepts the first working cross-platform command alternative', async () => {
    const deps = fakeDeps({
      exec: async (command) => {
        if (command === 'python3') throw Object.assign(new Error('not found'), { code: 'ENOENT' });
        return {};
      },
    });
    await expect(preflightTestHost(input({
      requiredToolchains: [{
        name: 'Python',
        commands: [['python3', '--version'], ['python', '--version']],
      }],
    }), deps)).resolves.toBeUndefined();
    expect(deps.execFile).toHaveBeenCalledTimes(2);
  });

  it('merges a toolchain probe environment with the inherited process environment', async () => {
    const deps = fakeDeps();
    await preflightTestHost(input({
      requiredToolchains: [{
        name: 'repository-local Python client',
        commands: [['python', '-c', 'import termwright']],
        env: { PYTHONPATH: '/repo/clients/python/src' },
      }],
    }), deps);
    expect(deps.execFile).toHaveBeenCalledWith(
      'python',
      ['-c', 'import termwright'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: process.env['PATH'],
          PYTHONPATH: '/repo/clients/python/src',
        }),
      }),
    );
  });

  it('aggregates disk and toolchain failures in declaration order', async () => {
    const deps = fakeDeps({
      freeBytes: 1n,
      exec: async (command) => { throw Object.assign(new Error(`missing ${command}`), { code: 'ENOENT' }); },
    });
    let failure: unknown;
    try {
      await preflightTestHost(input({
        requiredToolchains: [
          { name: 'Go', commands: [['go', 'version']] },
          { name: 'Rust', commands: [['rustc', '--version']] },
        ],
      }), deps);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TermwrightPreflightError);
    expect((failure as TermwrightPreflightError).issues).toEqual([
      expect.stringContaining('insufficient free disk space'),
      expect.stringContaining('"Go"'),
      expect.stringContaining('"Rust"'),
    ]);
  });

  it('walks to an existing parent when the run directory does not exist', async () => {
    const visited: string[] = [];
    const deps = fakeDeps();
    vi.mocked(deps.statfs).mockImplementation(async (path) => {
      visited.push(path);
      if (path !== '/repo') throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return { bavail: 2n, bsize: GIB };
    });
    await preflightTestHost(input(), deps);
    expect(visited).toEqual(['/repo/.termwright/runs', '/repo/.termwright', '/repo']);
  });

  it('allows callers to explicitly disable only the disk floor', async () => {
    const deps = fakeDeps({ freeBytes: 0n });
    await expect(preflightTestHost(input({ minimumFreeDiskBytes: 0n }), deps)).resolves.toBeUndefined();
    expect(deps.statfs).not.toHaveBeenCalled();
  });
});

function input(preflight: Parameters<typeof preflightTestHost>[0]['preflight'] = undefined) {
  return {
    cwd: '/repo',
    runsDir: '/repo/.termwright/runs',
    ...(preflight === undefined ? {} : { preflight }),
  };
}

function fakeDeps(options: {
  readonly freeBytes?: bigint;
  readonly exec?: (command: string) => Promise<Record<string, never>>;
} = {}): TermwrightPreflightDeps {
  return {
    statfs: vi.fn(async () => ({ bavail: options.freeBytes ?? 2n * GIB, bsize: 1n })),
    execFile: vi.fn(async (command) => options.exec?.(command) ?? {}),
  };
}
