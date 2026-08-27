#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

// Exact deterministic-core baseline measured on 2026-08-24 with the pinned
// Node 22 / Vitest 4.1.11. This validator is authoritative because embedded
// Vitest reports threshold failures without propagating a failing exit code.
const thresholds = Object.freeze({
  statements: 87.86,
  branches: 84.01,
  functions: 90.46,
  lines: 90.31,
});

const summary = JSON.parse(
  await readFile(new URL('../coverage/coverage-summary.json', import.meta.url), 'utf8'),
);
const failures = Object.entries(thresholds).flatMap(([metric, floor]) => {
  const actual = summary.total?.[metric]?.pct;
  if (typeof actual !== 'number') return [`coverage summary has no numeric total.${metric}.pct`];
  return actual < floor ? [`${metric}: ${actual}% is below the ${floor}% floor`] : [];
});

if (failures.length > 0) {
  console.error(`deterministic core coverage failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('deterministic core coverage meets the 87.86/84.01/90.46/90.31 baseline');
}
