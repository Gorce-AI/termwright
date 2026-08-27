#!/usr/bin/env node

import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './prepare-conpty-assets.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD_VENDOR_DESTINATION = resolve(ROOT, 'packages/pty/build/Release/vendor');

export function assertSafeStageDestination(destination) {
  const destinationRoot = resolve(destination);
  if (destinationRoot !== BUILD_VENDOR_DESTINATION) {
    throw new Error(`refusing to replace a non-build ConPTY destination: ${destinationRoot}`);
  }
  return destinationRoot;
}

export async function stageVendoredConpty({ architecture, destination }) {
  if (architecture !== 'x64' && architecture !== 'arm64') {
    throw new TypeError(`unsupported ConPTY architecture: ${architecture}`);
  }
  const source = resolve(ROOT, `packages/pty-win32-${architecture}/vendor`);
  const manifest = JSON.parse(await readFile(join(source, 'conpty-manifest.json'), 'utf8'));
  const expected = new Map(Object.entries(manifest.assets));
  const destinationRoot = assertSafeStageDestination(destination);
  if (destinationRoot === source) {
    throw new Error('refusing to replace the checked-in ConPTY source bundle');
  }
  await rm(destinationRoot, { force: true, recursive: true });
  for (const [relativePath, digest] of expected) {
    const input = join(source, relativePath);
    const bytes = await readFile(input);
    if (sha256(bytes) !== digest) throw new Error(`source ConPTY asset changed: ${relativePath}`);
    const output = join(destinationRoot, relativePath);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(input, output);
    if (sha256(await readFile(output)) !== digest)
      throw new Error(`staged ConPTY asset changed: ${relativePath}`);
  }
  for (const [filename, digest] of Object.entries(manifest.metadata)) {
    const input = join(source, filename);
    const bytes = await readFile(input);
    if (sha256(bytes) !== digest) throw new Error(`source ConPTY metadata changed: ${filename}`);
    const output = join(destinationRoot, filename);
    await copyFile(input, output);
    if (sha256(await readFile(output)) !== digest)
      throw new Error(`staged ConPTY metadata changed: ${filename}`);
  }
  await copyFile(
    join(source, 'conpty-manifest.json'),
    join(destinationRoot, 'conpty-manifest.json'),
  );
  return manifest;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const requestedArchitecture = argument('--architecture');
  if (requestedArchitecture === undefined && process.platform !== 'win32') {
    console.log(`no vendored ConPTY runtime is needed for ${process.platform}-${process.arch}`);
    process.exit(0);
  }
  const architecture = requestedArchitecture ?? process.arch;
  const destination = argument('--destination') ?? BUILD_VENDOR_DESTINATION;
  if (architecture !== 'x64' && architecture !== 'arm64') {
    console.log(`no vendored ConPTY runtime is needed for ${process.platform}-${architecture}`);
    process.exit(0);
  }
  const manifest = await stageVendoredConpty({ architecture, destination });
  console.log(`staged ${manifest.package} ${manifest.version} for ${architecture}`);
}
