import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(process.argv[2] ?? join(root, 'vitest-pty-matrix.json'));
const versions = list('TERMWRIGHT_MATRIX_VITEST', ['3.1.4', '3.2.7', '4.1.11']);
const pools = list('TERMWRIGHT_MATRIX_POOLS', ['forks', 'threads']);
const workerCounts = list('TERMWRIGHT_MATRIX_WORKERS', ['1', '2', '4']).map(Number);
const ptyConcurrency = list('TERMWRIGHT_MATRIX_PTYS', ['1', '2', '4', '8']).map(Number);
const fileParallelism = booleanList('TERMWRIGHT_MATRIX_FILE_PARALLELISM', ['true', 'false']);
const work = await mkdtemp(join(tmpdir(), 'termwright-vitest-matrix-'));
const results = [];

try {
  for (const version of versions) {
    const project = join(work, `vitest-${version}`);
    await cp(join(root, 'quality', 'experiments'), join(project, 'tests'), { recursive: true });
    await writeFile(join(project, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
    await execute(npmCommand(), ['install', '--no-audit', '--no-fund', `vitest@${version}`, '@lydell/node-pty@1.2.0-beta.15'], {
      cwd: project,
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    // Multiple files are required to exercise the worker pool itself; test
    // concurrency inside one file alone can never reveal cross-worker IPC loss.
    const source = join(project, 'tests', 'vitest-pty-pressure.test.mjs');
    for (let index = 1; index < 8; index += 1) {
      await cp(source, join(project, 'tests', `vitest-pty-pressure-${index}.test.mjs`));
    }
    for (const pool of pools) for (const workers of workerCounts) for (const terminals of ptyConcurrency) {
      for (const parallelFiles of fileParallelism) {
        const telemetry = join(project, `telemetry-${pool}-${workers}-${terminals}-files-${parallelFiles}.jsonl`);
        const started = performance.now();
        let code = 0;
        let stdout = '';
        let stderr = '';
        try {
          const workerArgs = version.startsWith('3.')
            ? ['--minWorkers', '1', '--maxWorkers', String(workers)]
            : ['--maxWorkers', String(workers)];
          const result = await execute(vitestCommand(project), [
            // Vitest 3.1 derives a CPU-sized minWorkers default which can
            // exceed an explicit small maxWorkers on large CI hosts. Pinning
            // the lower bound makes workers=1/2 an actual comparable matrix
            // cell instead of a Tinypool configuration error.
            'run', '--pool', pool, ...workerArgs,
            '--maxConcurrency', String(terminals),
            parallelFiles ? '--fileParallelism' : '--no-file-parallelism',
            'tests',
          ], {
            cwd: project,
            env: { ...process.env, TERMWRIGHT_MATRIX_CASES: '8', TERMWRIGHT_MATRIX_TELEMETRY: telemetry },
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
        let records = [];
        try {
          records = (await readFile(telemetry, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
        } catch { /* absence is itself evidence in the result */ }
        results.push({
          vitest: version, node: process.version, os: `${process.platform}-${process.arch}`,
          kind: 'single-pool', pool, workers, terminals, fileParallelism: parallelFiles,
          code, durationMs: performance.now() - started,
          telemetryRecords: records.length,
          workerPids: [...new Set(records.map((record) => record.pid))].sort((a, b) => a - b),
          peakRss: Math.max(0, ...records.map((record) => record.memory?.rss ?? 0)),
          channelClosed: /channel (?:closed|is closed)|ERR_IPC_CHANNEL_CLOSED/iu.test(`${stdout}\n${stderr}`),
          stdout: stdout.slice(-32_768), stderr: stderr.slice(-32_768),
        });
      }
    }
  }
} finally {
  await writeFile(output, `${JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  await rm(work, { recursive: true, force: true });
}

const certifiedFailures = results.filter((result) => result.vitest === '3.2.7' && result.code !== 0);
console.log(`Vitest/PTy matrix wrote ${results.length} cells to ${output}; certified failures: ${certifiedFailures.length}`);
if (certifiedFailures.length > 0) process.exitCode = 1;

function npmCommand() { return process.platform === 'win32' ? 'npm.cmd' : 'npm'; }
function vitestCommand(project) {
  return join(project, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest');
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
