#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

export const requiredExamples = Object.freeze([
  'examples/bubbletea-login',
  'examples/getting-started',
  'examples/ink-todo',
  'examples/opentui-form',
  'examples/ratatui-list',
  'examples/textual-notes',
  'examples/tview-menu',
]);

export const requiredExampleArguments = Object.freeze([
  'test',
  '--',
  '--resource-profile',
  'local',
  '--json',
  '--',
  '--run',
  ...requiredExamples,
]);

function waitForExit(child) {
  return new Promise((resolveRun, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal !== null) reject(new Error(`required example tests stopped by ${signal}`));
      else if (code !== 0) reject(new Error(`required example tests exited with code ${String(code)}`));
      else resolveRun();
    });
  });
}

/** Runs every public example with skips promoted to failures on every platform. */
export async function runRequiredExamples(options = {}) {
  const spawnProcess = options.spawnProcess ?? spawn;
  const npmExecPath = options.npmExecPath ?? process.env['npm_execpath'];
  const platform = options.platform ?? process.platform;
  const env = {
    ...process.env,
    ...options.env,
    TERMWRIGHT_REQUIRE_EXAMPLES: '1',
  };
  const command = npmExecPath ? process.execPath : platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const args = npmExecPath ? [npmExecPath, ...requiredExampleArguments] : [...requiredExampleArguments];
  await waitForExit(spawnProcess(command, args, { cwd: repositoryRoot, env, stdio: 'inherit' }));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runRequiredExamples();
}
