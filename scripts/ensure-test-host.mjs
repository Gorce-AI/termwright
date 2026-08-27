#!/usr/bin/env node

import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImmutableWorkspaceBuild } from './immutable-build-manifest.mjs';
import { pnpmInvocation } from './package-manager-command.mjs';

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
  const invocation = pnpmInvocation(['run', 'build'], { env: process.env });
  await run(invocation.command, invocation.args);
}

/** Ensures every worker will consume one fresh, fingerprinted workspace build. */
export async function ensureTestHost(options = {}) {
  const accessFile = options.accessFile ?? access;
  const build = options.build ?? buildTestHost;
  const verify = options.verify ?? (() => verifyImmutableWorkspaceBuild());
  let rebuild = false;
  try {
    await accessFile(testHostEntrypoint);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    rebuild = true;
  }
  if (!rebuild) {
    try {
      rebuild = (await verify()).length > 0;
    } catch (error) {
      if (!recoverableManifestError(error)) throw error;
      rebuild = true;
    }
  }
  if (!rebuild) return false;

  process.stdout.write(
    'Termwright workspace build is missing or stale; rebuilding before the Native Host starts...\n',
  );
  await build();
  await accessFile(testHostEntrypoint).catch((error) => {
    throw new Error(`test-host build completed without creating ${testHostEntrypoint}`, {
      cause: error,
    });
  });
  let issues;
  try {
    issues = await verify();
  } catch (error) {
    throw new Error('workspace build completed without a readable supported immutable manifest', {
      cause: error,
    });
  }
  if (issues.length > 0) {
    throw new Error(
      `workspace build completed without a fresh immutable manifest: ${issues.join('; ')}`,
    );
  }
  return true;
}

function recoverableManifestError(error) {
  if (error?.code === 'ENOENT' || error instanceof SyntaxError) return true;
  return (
    error instanceof Error &&
    /^(?:unsupported immutable build manifest|invalid immutable build artifact fingerprint|declared production artifact is missing:)/u.test(
      error.message,
    )
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await ensureTestHost();
}
