import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const roots = ['packages', 'clients', 'compatibility', 'examples'];
const outputPath = 'quality/determinism-constructs.json';
const sources = [];
for (const root of roots) await collect(root, sources);

const patterns = Object.freeze([
  ['wall-clock', /\bDate\.now\s*\(/gu],
  ['timer', /\bset(?:Timeout|Interval)\s*\(/gu],
  ['delay-helper', /\b(?:sleep|delay)\s*\(/gu],
  ['polling', /\b(?:expect\.)?poll\s*\(/gu],
  ['arbitrary-browser-wait', /\bwaitForTimeout\s*\(/gu],
  ['test-skip', /\b(?:it|test|describe)\.(?:skip|skipIf)\b/gu],
  ['fixed-listen-port', /\.listen\s*\(\s*[1-9][0-9]{2,5}\b/gu],
  ['process-global-mutation', /\bprocess\.(?:chdir\s*\(|env(?:\[[^\]]+\]|\.[A-Za-z_$][\w$]*)\s*=)/gu],
  ['fire-and-forget', /\bvoid\s+(?:this\.)?[A-Za-z_$][\w$#.]*\s*\(/gu],
]);

const findings = [];
for (const absolute of sources.sort()) {
  const path = relative('.', absolute).replaceAll('\\', '/');
  const source = await readFile(absolute, 'utf8');
  for (const [kind, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      const line = 1 + source.slice(0, index).split('\n').length - 1;
      const excerpt = source.slice(source.lastIndexOf('\n', index) + 1, source.indexOf('\n', index) < 0 ? source.length : source.indexOf('\n', index)).trim();
      findings.push(Object.freeze({
        path,
        line,
        kind,
        classification: classify(path, kind),
        excerpt,
      }));
    }
  }
}
findings.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.kind.localeCompare(right.kind));

const forbidden = findings.filter(({ kind }) => kind === 'arbitrary-browser-wait' || kind === 'fixed-listen-port');
if (forbidden.length > 0) {
  throw new Error(`forbidden deterministic constructs:\n${forbidden.map(({ path, line, kind }) => `  ${path}:${line} ${kind}`).join('\n')}`);
}

const report = {
  schemaVersion: 1,
  policy: {
    generatedBy: 'node scripts/audit-determinism-constructs.mjs --write',
    invariant: 'every timing, polling, skip, process-global mutation and unawaited task is classified; drift requires review',
    forbidden: ['arbitrary-browser-wait', 'fixed-listen-port'],
    platformSkips: 'additionally governed by quality/platform-deviations.json',
  },
  summary: Object.fromEntries([...new Set(findings.map(({ classification }) => classification))].sort().map((classification) => [classification, findings.filter((finding) => finding.classification === classification).length])),
  findings,
};
const encoded = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes('--write')) {
  await writeFile(outputPath, encoded);
  console.log(`wrote ${outputPath} (${findings.length} classified constructs)`);
} else {
  const current = await readFile(outputPath, 'utf8');
  if (current !== encoded) {
    throw new Error(`determinism construct inventory drifted; inspect the diff, remove accidental waits, then run node scripts/audit-determinism-constructs.mjs --write`);
  }
  console.log(`determinism constructs: ${findings.length} classified, zero forbidden, zero drift`);
}

function classify(path, kind) {
  const fixture = /(?:^|\/)(?:fixtures?|testing|test-fixtures)(?:\/|$)/u.test(path);
  const test = /(?:\.test|\.spec|\.e2e)\.[cm]?[jt]sx?$/u.test(path);
  if (kind === 'wall-clock') return 'display-or-persisted-wall-time-not-correctness-order';
  if (kind === 'test-skip') return 'explicit-test-selection-reviewed-with-platform-registry';
  if (kind === 'process-global-mutation') return test ? 'test-process-isolation-review' : 'production-process-isolation-review';
  if (kind === 'fire-and-forget') return test ? 'test-observer-or-intentional-background-task' : 'managed-or-diagnostic-background-task';
  if (fixture) return 'deterministic-adversarial-fixture-schedule';
  if (test) return kind === 'polling' ? 'explicit-external-or-ui-source-polling' : 'deadline-or-scheduler-regression-test';
  if (path === 'packages/driver/src/logs.ts') return 'explicit-external-file-polling';
  if (kind === 'polling') return 'production-polling-review';
  return 'bounded-deadline-or-managed-background-task';
}

async function collect(path, output) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'target', '.venv'].includes(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await collect(child, output);
    else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) output.push(child);
  }
}
