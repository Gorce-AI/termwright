import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { vitestInvocation } from './test-support/node-cli-invocation.mjs';
import { hasClosedChannelDiagnostic, isVitestPtyCellFailure } from './test-support/vitest-pty-diagnostics.mjs';
import { validateVitestPtyTelemetry } from './test-support/vitest-pty-telemetry.mjs';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(process.argv[2] ?? join(root, 'vitest-pty-matrix.json'));
const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const embeddedVitest = rootPackage.devDependencies?.vitest;
if (embeddedVitest !== '4.1.11') {
  throw new Error(`reliability matrix requires exact embedded Vitest 4.1.11, observed ${String(embeddedVitest)}`);
}
const casesPerFile = 8;
const filesPerCell = 8;
const versions = [embeddedVitest];
const pools = list('TERMWRIGHT_MATRIX_POOLS', ['forks', 'threads']);
const workerCounts = list('TERMWRIGHT_MATRIX_WORKERS', ['1', '2', '4']).map(Number);
const ptyConcurrency = list('TERMWRIGHT_MATRIX_PTYS', ['1', '2', '4', '8']).map(Number);
const fileParallelism = booleanList('TERMWRIGHT_MATRIX_FILE_PARALLELISM', ['true', 'false']);
// The pressure fixture imports the Termwright-owned native boundary from the
// driver workspace package. Nesting here preserves workspace resolution.
const workRoot = join(root, 'packages', 'driver', '.termwright', 'vitest-matrix');
await mkdir(workRoot, { recursive: true });
const work = await mkdtemp(join(workRoot, 'run-'));
const results = [];

try {
  for (const version of versions) {
    const project = join(work, `vitest-${version}`);
    await cp(join(root, 'quality', 'experiments'), join(project, 'tests'), { recursive: true });
    const driverBackend = pathToFileURL(join(root, 'packages', 'driver', 'dist', 'experimental.js')).href;
    await writeFile(join(project, 'driver-backend.mjs'), `export { createNativePtyBackend } from ${JSON.stringify(driverBackend)};\n`);
    await writeFile(join(project, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
    // Prevent Vitest from walking up into Termwright's product runner config:
    // this harness intentionally exercises the stock embedded engine directly.
    await writeFile(join(project, 'vitest.config.mjs'), 'export default { test: {} };\n');
    // Multiple files are required to exercise the worker pool itself; test
    // concurrency inside one file alone can never reveal cross-worker IPC loss.
    const source = join(project, 'tests', 'vitest-pty-pressure.test.mjs');
    for (let index = 1; index < 8; index += 1) {
      await cp(source, join(project, 'tests', `vitest-pty-pressure-${index}.test.mjs`));
    }
    for (const pool of pools) for (const workers of workerCounts) for (const terminals of ptyConcurrency) {
      for (const parallelFiles of fileParallelism) {
        const telemetry = join(project, `telemetry-${pool}-${workers}-${terminals}-files-${parallelFiles}`);
        await mkdir(telemetry);
        const started = performance.now();
        let code = 0;
        let stdout = '';
        let stderr = '';
        try {
          const workerArgs = ['--maxWorkers', String(workers)];
          // Execute the exact lockfile-backed workspace engine. Keeping the
          // temporary project under the repository also makes its test imports
          // resolve through that same immutable dependency closure.
          const vitest = vitestInvocation(root);
          const result = await execute(vitest.file, [...vitest.args,
            // Vitest 4.1 exposes maxWorkers (minWorkers was removed). The
            // fixture rendezvous and exact overlap validator independently
            // require the declared number of real workers to become active.
            'run', '--config', 'vitest.config.mjs', '--pool', pool, ...workerArgs,
            '--maxConcurrency', String(terminals),
            parallelFiles ? '--fileParallelism' : '--no-file-parallelism',
            'tests',
          ], {
            cwd: project,
            env: {
              ...process.env,
              TERMWRIGHT_MATRIX_CASES: String(casesPerFile),
              TERMWRIGHT_MATRIX_CELL_PTYS: String(terminals),
              TERMWRIGHT_MATRIX_FILE_PARALLELISM: String(parallelFiles),
              TERMWRIGHT_MATRIX_TELEMETRY: telemetry,
              TERMWRIGHT_MATRIX_WORKERS: String(workers),
            },
            timeout: 120_000,
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
          });
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (error) {
          code = typeof error === 'object' && error !== null && typeof error.code === 'number' ? error.code : 1;
          stdout = typeof error === 'object' && error !== null && typeof error.stdout === 'string' ? error.stdout : '';
          stderr = typeof error === 'object' && error !== null && typeof error.stderr === 'string' ? error.stderr : String(error);
        }
        const { records, errors: telemetryReadErrors } = await readTelemetryShards(telemetry, parallelFiles);
        const telemetryVerdict = validateVitestPtyTelemetry(records, {
          files: filesPerCell, casesPerFile, terminals, workers, fileParallelism: parallelFiles,
          node: process.version, platform: process.platform, arch: process.arch, readErrors: telemetryReadErrors,
        });
        results.push({
          vitest: version, node: process.version, os: `${process.platform}-${process.arch}`,
          kind: 'single-pool', pool, configuredMaxWorkers: workers,
          terminals, fileParallelism: parallelFiles,
          code, durationMs: performance.now() - started,
          telemetryRecords: records.length,
          workersObserved: [...new Set(records.map((record) => `${String(record.pid)}:${String(record.threadId)}`))].sort(),
          telemetryValid: telemetryVerdict.valid,
          telemetryErrors: telemetryVerdict.errors,
          peakRss: Math.max(0, ...records.map((record) => record.memory?.rss ?? 0)),
          channelClosed: hasClosedChannelDiagnostic(`${stdout}\n${stderr}`),
          stdout: stdout.slice(-32_768), stderr: stderr.slice(-32_768),
        });
      }
    }
  }
} finally {
  await writeFile(output, `${JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  await rm(work, { recursive: true, force: true });
}

const certifiedFailures = results.filter(isVitestPtyCellFailure);
if (process.env.TERMWRIGHT_MATRIX_CERTIFY === '1') validateCertifiedMatrix(results);
console.log(`Vitest/PTy matrix wrote ${results.length} cells to ${output}; certified failures: ${certifiedFailures.length}`);
if (certifiedFailures.length > 0) process.exitCode = 1;

async function readTelemetryShards(directory, parallelFiles) {
  const records = [];
  const errors = [];
  const sources = ['vitest-pty-pressure.test.mjs', ...Array.from(
    { length: filesPerCell - 1 }, (_, index) => `vitest-pty-pressure-${index + 1}.test.mjs`,
  )];
  const expectedNames = new Set(sources.flatMap((source) => [
    `${source}.jsonl`,
    ...(parallelFiles ? [`${source}.ready`] : []),
  ]));
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !expectedNames.delete(entry.name)) {
      errors.push(`unexpected telemetry shard ${entry.name}`);
    }
  }
  for (const missing of expectedNames) errors.push(`missing telemetry shard ${missing}`);
  for (const source of sources) {
    const path = join(directory, `${source}.jsonl`);
    try {
      const lines = (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean);
      const shard = lines.map((line) => JSON.parse(line));
      if (shard.some((record) => record?.source !== source)) {
        errors.push(`${source}: shard contains a foreign source identity`);
      }
      records.push(...shard);
    } catch (error) {
      errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { records, errors };
}

function validateCertifiedMatrix(entries) {
  const certified = entries.filter((entry) => entry.vitest === '4.1.11');
  const expected = new Set();
  for (const pool of ['forks', 'threads']) for (const workers of [1, 2, 4]) {
    for (const terminals of [1, 2, 4, 8]) for (const fileParallelism of [true, false]) {
      expected.add(`${pool}:${workers}:${terminals}:${fileParallelism}`);
    }
  }
  const actual = new Set(certified.map((entry) =>
    `${entry.pool}:${entry.configuredMaxWorkers}:${entry.terminals}:${entry.fileParallelism}`));
  if (certified.length !== expected.size || actual.size !== expected.size || [...expected].some((key) => !actual.has(key))) {
    throw new Error(`certified Vitest matrix is incomplete: expected ${expected.size} exact cells, observed ${actual.size}`);
  }
}

function list(name, defaults) {
  const value = process.env[name];
  return value === undefined ? defaults : value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function booleanList(name, defaults) {
  return list(name, defaults).map((value) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new TypeError(`${name} accepts only true,false; received ${value}`);
  });
}
