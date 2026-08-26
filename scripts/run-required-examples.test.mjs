import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requiredExamples, requiredExampleArguments, runRequiredExamples } from './run-required-examples.mjs';

const temporaryDirectories = [];

function fakePnpmCli() {
  const directory = mkdtempSync(join(tmpdir(), 'termwright-required-examples-'));
  temporaryDirectories.push(directory);
  const bin = join(directory, 'bin', 'pnpm.cjs');
  mkdirSync(join(directory, 'bin'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: 'pnpm',
    version: '9.4.0',
    bin: { pnpm: 'bin/pnpm.cjs' },
  }));
  writeFileSync(bin, "process.stdout.write('9.4.0\\n');\n");
  return realpathSync(bin);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

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
    const npmExecPath = fakePnpmCli();
    await runRequiredExamples({
      env: { npm_execpath: npmExecPath, TERMWRIGHT_REQUIRE_EXAMPLES: '0' },
      spawnProcess,
    });

    expect(spawnProcess).toHaveBeenCalledOnce();
    const [command, args, options] = spawnProcess.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual([npmExecPath, ...requiredExampleArguments]);
    expect(options.env.TERMWRIGHT_REQUIRE_EXAMPLES).toBe('1');
    expect(requiredExamples).toHaveLength(7);
  });

  it('fails closed on Windows when a real pnpm JavaScript CLI is unavailable', async () => {
    const spawnProcess = vi.fn(() => childThatExits());
    await expect(runRequiredExamples({
      env: { npm_execpath: '', PNPM_HOME: '' },
      platform: 'win32',
      spawnProcess,
    })).rejects.toThrow(/refusing a pnpm\.cmd or shell fallback/u);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('propagates a failed example run', async () => {
    await expect(runRequiredExamples({
      env: { npm_execpath: fakePnpmCli() },
      spawnProcess: () => childThatExits(7),
    })).rejects.toThrow('required example tests exited with code 7');
  });

  it('propagates a signal that stops the example run', async () => {
    await expect(runRequiredExamples({
      env: { npm_execpath: fakePnpmCli() },
      spawnProcess: () => childThatSignals('SIGTERM'),
    })).rejects.toThrow('required example tests stopped by SIGTERM');
  });

  it('propagates a process spawn error', async () => {
    await expect(runRequiredExamples({
      env: { npm_execpath: fakePnpmCli() },
      spawnProcess: () => childThatErrors(new Error('spawn failed')),
    })).rejects.toThrow('spawn failed');
  });

  it('keeps recursive workspace filters portable and non-vacuous', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.scripts.build).toContain('--filter=./packages/*');
    expect(manifest.scripts.build).toContain('--fail-if-no-match');
    expect(manifest.scripts.typecheck).toContain('--filter=./packages/* --fail-if-no-match');
    expect(manifest.scripts['check:full']).toBeUndefined();
    expect(manifest.scripts['check:local']).toContain('--filter=./examples/* --fail-if-no-match');
    expect(manifest.scripts['check:local']).toContain('pnpm test:examples');
    expect(manifest.scripts['check:local'].indexOf('--filter=./examples/* --fail-if-no-match run build'))
      .toBeLessThan(manifest.scripts['check:local'].indexOf('pnpm test -- --resource-profile local'));
    expect(manifest.scripts['check:local']).toContain('pnpm docs:api');
    expect(manifest.scripts['check:local']).toContain('git diff --exit-code -- website/src/content/docs/api');
    expect(`${manifest.scripts.build}\n${manifest.scripts.typecheck}\n${manifest.scripts['check:local']}`).not.toContain("--filter './");
  });

  it('stays aligned with the public example list certified by CI', async () => {
    const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const start = workflow.indexOf('      - name: Run every public example without skips');
    const end = workflow.indexOf('      - name: Upload failure reports', start);
    const ciExamples = workflow.slice(start, end).match(/examples\/[a-z0-9-]+/gu) ?? [];
    expect(ciExamples).toEqual(requiredExamples);
  });
});
