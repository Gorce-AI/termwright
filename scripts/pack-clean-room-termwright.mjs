#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { validatePackedArchive } from './pack-npm-artifacts.mjs';

const root = resolve(import.meta.dirname, '..');
const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--') arguments_.shift();
const output = resolve(arguments_.shift() ?? 'clean-room/npm');
const additionalRoots = arguments_;
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('npm_execpath is missing; invoke through pnpm');
mkdirSync(output, { recursive: true });
if (readdirSync(output).length > 0) throw new Error(`output directory is not empty: ${output}`);

const packages = new Map();
for (const directory of readdirSync(join(root, 'packages'))) {
  const manifestPath = join(root, 'packages', directory, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.private !== true) packages.set(manifest.name, { directory, manifest });
}

const selected = new Set();
const visit = (name) => {
  if (selected.has(name)) return;
  const entry = packages.get(name);
  if (!entry) return;
  selected.add(name);
  for (const dependency of [
    ...Object.keys(entry.manifest.dependencies ?? {}),
    ...Object.keys(entry.manifest.optionalDependencies ?? {}),
  ]) {
    if (dependency.startsWith('@termwright/pty-')) continue;
    visit(dependency);
  }
};
visit('termwright');
for (const name of additionalRoots) {
  if (!packages.has(name)) throw new Error(`unknown clean-room package root ${name}`);
  visit(name);
}

const nativeName = `@termwright/pty-${process.platform}-${process.arch}`;
if (!packages.has(nativeName))
  throw new Error(`no native package for ${process.platform}-${process.arch}`);
selected.add(nativeName);

const nativeEntry = packages.get(nativeName);
const nativeBinary = join(root, 'packages', nativeEntry.directory, 'termwright_pty.node');
const builtBinary = join(root, 'packages', 'pty', 'build', 'Release', 'termwright_pty.node');
let staged = false;
if (!existsSync(nativeBinary)) {
  if (!existsSync(builtBinary))
    throw new Error('build the native PTY addon before clean-room packing');
  copyFileSync(builtBinary, nativeBinary);
  staged = true;
}

try {
  for (const name of [...selected].sort()) {
    const { directory } = packages.get(name);
    const before = new Set(readdirSync(output));
    execFileSync(
      process.execPath,
      [pnpmCli, '--dir', `packages/${directory}`, 'pack', '--pack-destination', output],
      { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const created = readdirSync(output).filter((file) => !before.has(file));
    if (created.length !== 1) throw new Error(`packing ${name} created ${created.length} archives`);
    validatePackedArchive(join(output, created[0]), name);
  }
} finally {
  if (staged) rmSync(nativeBinary);
}

console.log(
  `packed ${selected.size} clean-room packages for ${process.platform}-${process.arch} in ${basename(output)}` +
    (additionalRoots.length === 0 ? '' : ` (additional roots: ${additionalRoots.join(', ')})`),
);
