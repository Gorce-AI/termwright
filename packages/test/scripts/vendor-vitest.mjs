#!/usr/bin/env node

import { createRequire } from 'node:module';
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const CERTIFIED_VERSION = '4.1.11';
const packageRoot = resolve(import.meta.dirname, '..');
const vendorRoot = join(packageRoot, 'vendor', 'vitest');
const distRoot = join(packageRoot, 'dist');
const require = createRequire(import.meta.url);
const sourceManifest = require.resolve('vitest/package.json');
const sourceRoot = dirname(sourceManifest);

const mode = process.argv[2];
if (mode === 'prepare') {
  const manifest = JSON.parse(readFileSync(sourceManifest, 'utf8'));
  if (manifest.name !== 'vitest' || manifest.version !== CERTIFIED_VERSION) {
    throw new Error(
      `expected certified Vitest ${CERTIFIED_VERSION}, found ${String(manifest.name)}@${String(manifest.version)}`,
    );
  }
  rmSync(vendorRoot, { recursive: true, force: true });
  cpSync(sourceRoot, vendorRoot, {
    recursive: true,
    filter: (source) =>
      source === sourceRoot || relative(sourceRoot, source).split(sep)[0] !== 'node_modules',
  });
  console.log(`vendored exact Vitest ${CERTIFIED_VERSION} runtime`);
} else if (mode === 'seal') {
  for (const file of walk(distRoot)) {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue;
    const before = readFileSync(file, 'utf8');
    const after = before.replace(
      /\b(from\s+|import\(|require\(|declare\s+module\s+)(["'])vitest(?:\/([^"']+))?\2/gu,
      (_match, prefix, quote, subpath) => {
        const target =
          subpath === 'package.json'
            ? join(vendorRoot, 'package.json')
            : subpath === 'node' || subpath === 'config'
              ? join(vendorRoot, 'dist', `${subpath}.js`)
              : subpath === undefined
                ? join(vendorRoot, 'dist', 'index.js')
                : join(vendorRoot, subpath);
        let specifier = relative(dirname(file), target).split(sep).join('/');
        if (!specifier.startsWith('.')) specifier = `./${specifier}`;
        return `${prefix}${quote}${specifier}${quote}`;
      },
    );
    if (after !== before) writeFileSync(file, after);
  }
  const survivors = walk(distRoot).filter((file) => {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) return false;
    return /\b(?:from\s+|import\(|require\(|declare\s+module\s+)["']vitest(?:\/|["'])/u.test(
      readFileSync(file, 'utf8'),
    );
  });
  if (survivors.length > 0) {
    throw new Error(`unsealed Vitest imports: ${survivors.join(', ')}`);
  }
  console.log('sealed @termwright/test to its private vendored Vitest runtime');
} else {
  throw new Error('usage: vendor-vitest.mjs prepare|seal');
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
