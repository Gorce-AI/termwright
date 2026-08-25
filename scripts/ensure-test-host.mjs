#!/usr/bin/env node

import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
export const testHostEntrypoint = fileURLToPath(
  new URL('../packages/termwright-cli/dist/bin.js', import.meta.url),
);

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal !== null) reject(new Error(`test-host build stopped by ${signal}`));
      else if (code !== 0) reject(new Error(`test-host build exited with code ${String(code)}`));
      else resolveRun();
    });
  });
}

async function buildTestHost() {
  const pnpmCli = process.env['npm_execpath'];
  if (pnpmCli !== undefined && pnpmCli.length > 0) {
    await run(process.execPath, [pnpmCli, '--filter', 'termwright...', 'build']);
    return;
  }
  await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', 'termwright...', 'build']);
}

/** Ensures the root test script has a runnable host, building it only when absent. */
export async function ensureTestHost(options = {}) {
  const accessFile = options.accessFile ?? access;
  const build = options.build ?? buildTestHost;
  try {
    await accessFile(testHostEntrypoint);
    return false;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  process.stdout.write('Termwright test host is not built; building its workspace dependency closure...\n');
  await build();
  await accessFile(testHostEntrypoint).catch((error) => {
    throw new Error(`test-host build completed without creating ${testHostEntrypoint}`, { cause: error });
  });
  return true;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await ensureTestHost();
}
