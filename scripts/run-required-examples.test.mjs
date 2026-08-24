import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { requiredExamples, requiredExampleArguments, runRequiredExamples } from './run-required-examples.mjs';

function childThatExits(code = 0) {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit('exit', code, null));
  return child;
}

function childThatSignals(signal) {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit('exit', null, signal));
  return child;
}

function childThatErrors(error) {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit('error', error));
  return child;
}

describe('required public examples', () => {
  it('uses pnpm through Node and promotes every missing prerequisite to a failure', async () => {
    const spawnProcess = vi.fn(() => childThatExits());
    await runRequiredExamples({
      env: { TERMWRIGHT_REQUIRE_EXAMPLES: '0' },
      npmExecPath: '/tools/pnpm.cjs',
      spawnProcess,
    });

    expect(spawnProcess).toHaveBeenCalledOnce();
    const [command, args, options] = spawnProcess.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(['/tools/pnpm.cjs', ...requiredExampleArguments]);
    expect(options.env.TERMWRIGHT_REQUIRE_EXAMPLES).toBe('1');
    expect(requiredExamples).toHaveLength(7);
  });

  it('uses the Windows pnpm shim when npm_execpath is unavailable', async () => {
    const spawnProcess = vi.fn(() => childThatExits());
    await runRequiredExamples({ npmExecPath: '', platform: 'win32', spawnProcess });
    expect(spawnProcess).toHaveBeenCalledWith('pnpm.cmd', [...requiredExampleArguments], expect.any(Object));
  });

  it('propagates a failed example run', async () => {
    await expect(runRequiredExamples({
      npmExecPath: '/tools/pnpm.cjs',
      spawnProcess: () => childThatExits(7),
    })).rejects.toThrow('required example tests exited with code 7');
  });

  it('propagates a signal that stops the example run', async () => {
    await expect(runRequiredExamples({
      npmExecPath: '/tools/pnpm.cjs',
      spawnProcess: () => childThatSignals('SIGTERM'),
    })).rejects.toThrow('required example tests stopped by SIGTERM');
  });

  it('propagates a process spawn error', async () => {
    await expect(runRequiredExamples({
      npmExecPath: '/tools/pnpm.cjs',
      spawnProcess: () => childThatErrors(new Error('spawn failed')),
    })).rejects.toThrow('spawn failed');
  });

  it('keeps recursive workspace filters portable and non-vacuous', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.scripts.build).toContain('--filter=./packages/* --fail-if-no-match');
    expect(manifest.scripts.typecheck).toContain('--filter=./packages/* --fail-if-no-match');
    expect(manifest.scripts['check:full']).toContain('--filter=./examples/* --fail-if-no-match');
    expect(manifest.scripts['check:full']).toContain('pnpm test:examples');
    expect(`${manifest.scripts.build}\n${manifest.scripts.typecheck}\n${manifest.scripts['check:full']}`).not.toContain("--filter './");
  });

  it('stays aligned with the public example list certified by CI', async () => {
    const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const start = workflow.indexOf('      - name: Run every public example without skips');
    const end = workflow.indexOf('      - name: Upload failure reports', start);
    const ciExamples = workflow.slice(start, end).match(/examples\/[a-z0-9-]+/gu) ?? [];
    expect(ciExamples).toEqual(requiredExamples);
  });
});
