import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bootstrapPackageOrder,
  parseArguments,
  validatePackageSelection,
  validatePackedArchive,
} from './pack-npm-artifacts.mjs';

const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function archive({ name, windows = false, unsafe = false, addon = true, hosts }) {
  const root = mkdtempSync(join(tmpdir(), 'termwright-pack-check-'));
  temporary.push(root);
  const packageRoot = join(root, 'package');
  mkdirSync(join(packageRoot, 'vendor'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name,
      version: '0.2.0',
      repository: { url: 'git+https://github.com/Gorce-AI/termwright.git' },
    }),
  );
  if (addon) writeFileSync(join(packageRoot, 'termwright_pty.node'), 'addon');
  if (windows) {
    for (const member of [
      'conpty.dll',
      'conpty-manifest.json',
      'LICENSE.microsoft-terminal.txt',
      'THIRD_PARTY_NOTICES.md',
      'SBOM.spdx.json',
    ])
      writeFileSync(join(packageRoot, 'vendor', member), member);
    const hostArchitectures =
      hosts ?? (name === '@termwright/pty-win32-x64' ? ['arm64', 'x64'] : ['arm64']);
    for (const architecture of hostArchitectures) {
      mkdirSync(join(packageRoot, 'vendor', architecture), { recursive: true });
      writeFileSync(join(packageRoot, 'vendor', architecture, 'OpenConsole.exe'), architecture);
    }
  }
  if (unsafe) writeFileSync(join(packageRoot, 'vendor', 'OpenConsole.exe'), 'unsafe');
  const result = join(root, 'package.tgz');
  execFileSync('tar', ['-czf', result, 'package'], { cwd: root });
  return result;
}

describe('npm artifact packing contract', () => {
  it('accepts pnpm script argument forwarding without weakening option parsing', () => {
    expect(
      parseArguments([
        '--',
        '--output',
        'bootstrap/npm',
        '--package-list',
        'scripts/npm-bootstrap-packages.json',
        '--manifest',
        'bootstrap/bootstrap-manifest.json',
        '--source-sha',
        'a'.repeat(40),
      ]),
    ).toEqual({
      output: 'bootstrap/npm',
      packageList: 'scripts/npm-bootstrap-packages.json',
      manifest: 'bootstrap/bootstrap-manifest.json',
      sourceSha: 'a'.repeat(40),
    });
    expect(() => parseArguments(['--', '--output', 'out', '--publish', 'true'])).toThrow(
      'unknown argument: --publish',
    );
    expect(
      parseArguments([
        '--output',
        'preview/npm',
        '--manifest',
        'preview/manifest.json',
        '--source-sha',
        'b'.repeat(40),
      ]),
    ).toMatchObject({ packageList: undefined, manifest: 'preview/manifest.json' });
    expect(() => parseArguments(['--output', 'out', '--package-list', 'packages.json'])).toThrow(
      '--package-list requires --manifest',
    );
    expect(() => parseArguments(['--output', 'out', '--manifest', 'manifest.json'])).toThrow(
      '--manifest requires --source-sha',
    );
    expect(() => parseArguments(['--output', 'out', '--source-sha', 'c'.repeat(40)])).toThrow(
      '--source-sha requires --manifest',
    );
  });

  it('requires all native packages before the wrapper in the bootstrap plan', () => {
    const names = [...bootstrapPackageOrder];
    const manifests = new Map(names.map((name) => [name, { manifest: { name } }]));
    expect(() => validatePackageSelection(names, manifests, { bootstrap: true })).not.toThrow();
    const reordered = [...names];
    reordered.splice(0, 1);
    reordered.splice(10, 0, '@termwright/pty-darwin-arm64');
    expect(() => validatePackageSelection(reordered, manifests, { bootstrap: true })).toThrow(
      'must exactly match the reviewed publication order',
    );
  });

  it('accepts a complete Windows native archive and rejects an incomplete or unsafe one', () => {
    const name = '@termwright/pty-win32-x64';
    expect(validatePackedArchive(archive({ name, windows: true }), name).name).toBe(name);
    expect(() =>
      validatePackedArchive(archive({ name, windows: true, addon: false }), name),
    ).toThrow('carries no addon');
    expect(() => validatePackedArchive(archive({ name, windows: true, hosts: [] }), name)).toThrow(
      'invalid OpenConsole inventory',
    );
    expect(() =>
      validatePackedArchive(archive({ name, windows: true, unsafe: true }), name),
    ).toThrow('invalid OpenConsole inventory');
  });
});
