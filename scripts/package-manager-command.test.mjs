import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pnpmInvocation } from './package-manager-command.mjs';

const temporaryDirectories = [];

function fakePnpm(packageRoot, version = '9.4.0') {
  const bin = join(packageRoot, 'bin', 'pnpm.cjs');
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: 'pnpm',
    version,
    bin: { pnpm: 'bin/pnpm.cjs' },
  }));
  writeFileSync(bin, `process.stdout.write('${version}\\n');\n`);
  return realpathSync(bin);
}

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'termwright-pnpm-resolution-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe('portable pnpm command resolution', () => {
  it('binds a validated inherited pnpm CLI to the current Node executable', () => {
    const cli = fakePnpm(join(temporaryDirectory(), 'pnpm'));
    expect(pnpmInvocation(['--version'], {
      env: { npm_execpath: cli },
      nodeExecutable: '/tools/node',
      platform: 'win32',
    })).toEqual({ command: '/tools/node', args: [cli, '--version'] });
  });

  it('resolves the real CLI from the standard PNPM_HOME global installation', () => {
    const home = temporaryDirectory();
    const cli = fakePnpm(join(home, 'global', '5', 'node_modules', 'pnpm'));
    expect(pnpmInvocation(['run', 'test'], {
      env: { PNPM_HOME: home },
      nodeExecutable: '/tools/node',
      platform: 'win32',
    })).toEqual({ command: '/tools/node', args: [cli, 'run', 'test'] });
  });

  it('resolves the pnpm/action-setup package next to its .bin PNPM_HOME', () => {
    const nodeModules = join(temporaryDirectory(), 'node_modules');
    fakePnpm(join(nodeModules, 'pnpm'), '11.0.0');
    const home = join(nodeModules, '.bin');
    const cli = fakePnpm(join(home, 'global', 'v11', 'opaque-install-id', 'node_modules', 'pnpm'));
    expect(pnpmInvocation(['--version'], {
      env: { PNPM_HOME: home },
      nodeExecutable: '/tools/node',
      platform: 'win32',
    })).toEqual({ command: '/tools/node', args: [cli, '--version'] });
  });

  it('fails closed on Windows instead of returning a .cmd or shell invocation', () => {
    expect(() => pnpmInvocation(['run', 'test'], { env: {}, platform: 'win32' }))
      .toThrow(/npm_execpath or PNPM_HOME.*refusing a pnpm\.cmd or shell fallback/u);
  });

  it('uses the ordinary executable name on POSIX', () => {
    expect(pnpmInvocation(['run', 'test'], { env: {}, platform: 'linux' }))
      .toEqual({ command: 'pnpm', args: ['run', 'test'] });
  });

  it('rejects an arbitrary JavaScript file that is not the declared pnpm package bin', () => {
    const path = join(temporaryDirectory(), 'pnpm.cjs');
    writeFileSync(path, "process.stdout.write('not pnpm');\n");
    expect(() => pnpmInvocation([], { env: { npm_execpath: path }, platform: 'win32' }))
      .toThrow(/validated pnpm JavaScript CLI/u);
  });

  it('rejects a command that cannot be passed to execFile exactly', () => {
    expect(() => pnpmInvocation(['test', 1], { env: {} }))
      .toThrow(/array of strings/u);
  });

  it('runs the installed pnpm --version through the resolved command', () => {
    const invocation = pnpmInvocation(['--version'], { env: process.env });
    const version = execFileSync(invocation.command, invocation.args, { encoding: 'utf8' }).trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/u);
  });
});
