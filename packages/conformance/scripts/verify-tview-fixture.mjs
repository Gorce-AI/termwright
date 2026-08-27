#!/usr/bin/env node
/** Verify the pre-host tview build contract without starting a compiler. */

import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const contractPath = process.argv[2];
if (contractPath === undefined || contractPath === '') {
  throw new Error('tview fixture verifier requires the per-run contract path');
}
const fixtureRoot = dirname(contractPath);
const expectedPaths = {
  instrumented: process.argv[3],
  baseline: process.argv[4],
};

function fail(detail) {
  throw new Error(
    `tview conformance fixture is not prepared: ${detail}. ` +
      'Run the conformance orchestrator so it can prepare a fresh fixture before opening the native test host.',
  );
}

let contract;
try {
  contract = JSON.parse(await readFile(contractPath, 'utf8'));
} catch (error) {
  fail(`contract is unavailable (${error instanceof Error ? error.message : String(error)})`);
}
if (contract.schemaVersion !== 1)
  fail(`unsupported contract schema ${String(contract.schemaVersion)}`);
if (contract.platform !== platform() || contract.arch !== arch()) {
  fail(
    `artifact targets ${String(contract.platform)}/${String(contract.arch)}, host is ${platform()}/${arch()}`,
  );
}

for (const name of ['instrumented', 'baseline']) {
  const entry = contract.binaries?.[name];
  if (typeof entry?.file !== 'string' || typeof entry.sha256 !== 'string')
    fail(`${name} metadata is invalid`);
  const path = resolve(fixtureRoot, entry.file);
  const relativePath = relative(fixtureRoot, path);
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    fail(`${name} binary escapes the fixture directory`);
  }
  const expectedPath = expectedPaths[name];
  if (typeof expectedPath !== 'string' || expectedPath === '') {
    fail(`${name} launch path was not provided`);
  }
  if (path !== resolve(expectedPath)) {
    fail(`${name} launch path does not match its build contract`);
  }
  try {
    await access(path, constants.X_OK);
  } catch (error) {
    fail(
      `${name} binary is not executable (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const actual = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
  if (actual !== entry.sha256) fail(`${name} binary digest does not match its build contract`);
}
