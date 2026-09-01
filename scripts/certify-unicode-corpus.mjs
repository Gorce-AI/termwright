import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  assertExactCorpusCoverage,
  normalizeGeometry,
  observedGapIds,
} from './unicode-certification.mjs';
import { UNICODE_CORPUS } from './unicode-corpus.mjs';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const probe = fileURLToPath(new URL('./unicode-engine-probe.mjs', import.meta.url));
const engines = [
  'termwright-graphemes',
  'xterm-unicode11',
  'xterm-graphemes-fixed-trie-model',
  'ghostty-default',
  'ghostty-grapheme-mode',
  'wterm-ghostty',
  'wterm-ghostty-grapheme-mode',
  'vterm-reference',
];

const reports = [];
for (const engine of engines) {
  const { stdout } = await execFileAsync(process.execPath, [probe, engine], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const reportLines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'));
  if (reportLines.length !== 1) {
    throw new Error(
      `${engine}: expected exactly one JSON report after diagnostics, received ${reportLines.length}`,
    );
  }
  reports.push(JSON.parse(reportLines[0]));
}

const expectedCaseIds = UNICODE_CORPUS.map((entry) => entry.id);
assertExactCorpusCoverage(reports, expectedCaseIds);

const expectedGaps = JSON.parse(
  await readFile(new URL('./unicode-conformance-gaps.json', import.meta.url), 'utf8'),
);
const gapClassifications = new Set([
  'termwright-bug',
  'backend-bug',
  'intentional-terminal-profile-difference',
  'unclear-needs-research',
]);
const expectedEngines = Object.keys(expectedGaps).sort();
const observedEngines = reports.map((report) => report.engine).sort();
if (JSON.stringify(expectedEngines) !== JSON.stringify(observedEngines)) {
  throw new Error(
    `Unicode gap ledger engines changed; expected ${JSON.stringify(expectedEngines)}, observed ${JSON.stringify(observedEngines)}`,
  );
}

const differences = [];
const canonical = reports.find((report) => report.engine === 'termwright-graphemes');
if (canonical === undefined) throw new Error('canonical Termwright Unicode report is missing');
for (const id of expectedCaseIds) {
  const observations = Object.fromEntries(
    reports.map((report) => {
      const entry = report.cases.find((candidate) => candidate.id === id);
      if (entry === undefined) throw new Error(`${report.engine}: missing ${id}`);
      return [report.engine, normalizeGeometry(entry)];
    }),
  );
  if (new Set(Object.values(observations).map((value) => JSON.stringify(value))).size > 1) {
    const corpusCase = UNICODE_CORPUS.find((entry) => entry.id === id);
    if (
      corpusCase?.expectedColumns === undefined &&
      (!gapClassifications.has(corpusCase.differenceClassification) ||
        typeof corpusCase.differenceNote !== 'string' ||
        corpusCase.differenceNote === '')
    ) {
      throw new Error(
        `${id}: unconstrained cross-engine difference needs a classification and note`,
      );
    }
    differences.push({ id, observations });
  }
}

process.stdout.write(
  `${JSON.stringify({ node: process.version, reports, differences }, null, 2)}\n`,
);

for (const report of reports) {
  const actual = observedGapIds(report, canonical);
  const failures = report.cases.filter((entry) => actual.includes(entry.id));
  const ledgerEntries = expectedGaps[report.engine] ?? [];
  for (const entry of ledgerEntries) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.case !== 'string' ||
      !gapClassifications.has(entry.classification) ||
      typeof entry.note !== 'string' ||
      entry.note === ''
    ) {
      throw new Error(`${report.engine}: every gap needs a case, classification and note`);
    }
  }
  const expected = ledgerEntries.map((entry) => entry.case).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${report.engine}: conformance gaps changed; expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`,
    );
  }
  if (failures.length > 0) {
    process.stderr.write(
      `${report.engine}: ${failures.map((failure) => `${failure.id}=${failure.markerColumn}/${failure.expectedColumns}`).join(', ')}\n`,
    );
  }
}
