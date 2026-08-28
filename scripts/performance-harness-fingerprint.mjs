#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectExecution } from './is-direct-execution.mjs';

export const PERFORMANCE_HARNESS_FINGERPRINT_KIND = 'termwright-performance-harness-fingerprint';
export const PERFORMANCE_HARNESS_FINGERPRINT_VERSION = 1;

/**
 * Closed methodology surface shared by the two paired performance checkouts.
 *
 * Production packages and the dependency lockfile are deliberately absent:
 * they are the subject of the comparison, not part of its measuring device.
 * Controller-only fingerprint/extraction scripts are also absent because the
 * seed checkout does not execute or need to contain them; their own hashes are
 * recorded separately in paired provenance.
 */
export const PERFORMANCE_HARNESS_FILES = Object.freeze(
  [
    'packages/performance/package.json',
    'packages/performance/tsconfig.json',
    'packages/performance/src/charm-e2e.ts',
    'packages/performance/src/charm.ts',
    'packages/performance/src/cli.ts',
    'packages/performance/src/fixtures.ts',
    'packages/performance/src/index.ts',
    'packages/performance/src/opentui-marker-e2e.ts',
    'packages/performance/src/opentui-marker.ts',
    'packages/performance/src/report.ts',
    'packages/performance/src/report-schema.ts',
    'packages/performance/baselines/darwin-arm64-node24-go1.25-bun1.2.15.policy.json',
    'packages/probe-charm/src/testing/fixture-v2/go.mod',
    'packages/probe-charm/src/testing/fixture-v2/go.sum',
    'packages/probe-charm/src/testing/fixture-v2/main.go',
    'packages/probe-opentui/bench/marker-route.ts',
    'quality/soak/terminal-cycle.test.ts',
    'quality/soak/vitest.config.ts',
    'quality/stress/terminal-concurrency.test.ts',
    'quality/stress/vitest.config.ts',
    'scripts/collect-quality-performance.mjs',
    'scripts/is-direct-execution.mjs',
    'scripts/performance-environment.mjs',
    'scripts/quality-performance-checkpoint.mjs',
    'scripts/quality-performance-timing.mjs',
    'scripts/test-support/process-resource-observation.mjs',
  ].sort(),
);

export async function fingerprintPerformanceHarness({
  root,
  expectedFiles = PERFORMANCE_HARNESS_FILES,
}) {
  const canonicalRoot = resolve(root);
  requireExactFileContract(expectedFiles);
  const files = [];
  for (const path of PERFORMANCE_HARNESS_FILES) {
    const absolute = resolve(canonicalRoot, path);
    let metadata;
    let contents;
    try {
      [metadata, contents] = await Promise.all([lstat(absolute), readFile(absolute)]);
    } catch (error) {
      throw new Error(`performance harness file is missing or unreadable: ${path}`, {
        cause: error,
      });
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`performance harness path is not a regular file: ${path}`);
    }
    files.push(Object.freeze({ path, sha256: sha256(contents) }));
  }
  const identity = {
    kind: PERFORMANCE_HARNESS_FINGERPRINT_KIND,
    schemaVersion: PERFORMANCE_HARNESS_FINGERPRINT_VERSION,
    algorithm: 'sha256',
    files,
  };
  return Object.freeze({
    ...identity,
    sha256: sha256(Buffer.from(canonicalJson(identity))),
  });
}

function requireExactFileContract(expectedFiles) {
  if (
    !Array.isArray(expectedFiles) ||
    expectedFiles.some((path) => typeof path !== 'string' || !canonicalPath(path))
  ) {
    throw new Error(
      'performance harness expected files must be canonical repository-relative paths',
    );
  }
  const actual = [...expectedFiles].sort();
  if (
    new Set(actual).size !== actual.length ||
    actual.length !== PERFORMANCE_HARNESS_FILES.length ||
    actual.some((path, index) => path !== PERFORMANCE_HARNESS_FILES[index])
  ) {
    throw new Error(
      `performance harness expected-file contract differs from the canonical ${PERFORMANCE_HARNESS_FILES.length}-file list`,
    );
  }
}

function canonicalPath(path) {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const options = {
    root: resolve(fileURLToPath(new URL('..', import.meta.url))),
    output: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if ((name !== '--root' && name !== '--output') || value === undefined || value.length === 0) {
      throw new Error(
        'usage: performance-harness-fingerprint.mjs [--root <checkout>] [--output <json>]',
      );
    }
    options[name.slice(2)] = value;
    index += 1;
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const fingerprint = await fingerprintPerformanceHarness({ root: options.root });
  const output = `${JSON.stringify(fingerprint, null, 2)}\n`;
  if (options.output === undefined) process.stdout.write(output);
  else await writeFile(resolve(options.output), output, 'utf8');
}

if (isDirectExecution(import.meta.url)) {
  await main(process.argv.slice(2));
}
