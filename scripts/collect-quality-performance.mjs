import { spawn, execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePerformanceEnvironment } from './performance-environment.mjs';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const environmentDescriptor = JSON.parse(await readFile(resolve(args.environmentFile), 'utf8'));
validatePerformanceEnvironment(environmentDescriptor, {
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.versions.node,
});
const environment = environmentDescriptor.class;
const runsDir = resolve(root, '.termwright', 'runs');
const before = new Set(await directories(runsDir));

const soak = await observe([
  'packages/termwright-cli/dist/bin.js', 'test', '--runs', String(args.cycles),
  '--resource-profile', 'ci', '--json', '--', '--config', 'quality/soak/vitest.config.ts',
  '--run', 'quality/soak/terminal-cycle.test.ts',
]);
const afterSoak = new Set(await directories(runsDir));
const soakRuns = [...afterSoak].filter((name) => !before.has(name));
const stress = await observe([
  'packages/termwright-cli/dist/bin.js', 'test', '--resource-profile', 'stress', '--json', '--',
  '--config', 'quality/stress/vitest.config.ts', '--run', 'quality/stress/terminal-concurrency.test.ts',
]);
const afterStress = new Set(await directories(runsDir));
const stressRuns = [...afterStress].filter((name) => !afterSoak.has(name));

const soakManifests = await manifests(soakRuns);
const stressManifests = await manifests(stressRuns);
if (soakManifests.length !== args.cycles) {
  throw new Error(`expected ${args.cycles} soak manifests, observed ${soakManifests.length}`);
}
if (stressManifests.length !== 1) {
  throw new Error(`expected one stress manifest, observed ${stressManifests.length}`);
}
const orderedSoak = [...soakManifests].sort((left, right) => left.startedAt - right.startedAt);
const first = orderedSoak[0];
const firstAttemptAt = Math.min(...first.events
  .filter((event) => event.type === 'attempt.started')
  .map((event) => event.wallTime));

const leakedProcesses = soak.leakedProcesses + stress.leakedProcesses;
const leakedFileDescriptors = soak.leakedFileDescriptors + stress.leakedFileDescriptors;
const observations = {
  generatedAt: new Date().toISOString(),
  environment,
  metrics: {
    startupMs: observation(firstAttemptAt - first.startedAt, 'milliseconds', 'quality/soak first run: manifest start to first attempt'),
    perTestOverheadMs: observation(
      average(orderedSoak.slice(1).map((manifest) =>
        manifest.finishedAt - manifest.startedAt
        - manifest.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0))),
      'milliseconds',
      `quality/soak ${args.cycles - 1} post-startup runs: collection and finalization time outside the test attempt`,
    ),
    peakRssBytes: observation(Math.max(soak.peakRssBytes, stress.peakRssBytes), 'bytes', 'maximum aggregate RSS of the certified host process tree across soak and stress'),
    peakOpenFileDescriptors: observation(Math.max(soak.peakOpenFileDescriptors, stress.peakOpenFileDescriptors), 'count', 'maximum open descriptors in the certified host process tree across soak and stress'),
    leakedFileDescriptors: observation(leakedFileDescriptors, 'count', 'descriptors owned by observed descendants still alive after certified host exit'),
    leakedProcesses: observation(leakedProcesses, 'count', 'observed descendants still alive after certified host exit'),
  },
};
await writeFile(resolve(args.output), `${JSON.stringify(observations, null, 2)}\n`, 'utf8');
process.stdout.write(`quality performance observations written to ${args.output}\n`);

async function observe(nodeArgs) {
  const child = spawn(process.execPath, nodeArgs, {
    cwd: root,
    env: { ...process.env, TERMWRIGHT_RETRIES: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.pid === undefined) throw new Error('measurement child did not receive a pid');
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let peakRssBytes = 0;
  let peakOpenFileDescriptors = 0;
  const observed = new Set();
  let sampling = false;
  let samplingError;
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      const table = await processTable();
      const pids = descendants(child.pid, table);
      for (const pid of pids) observed.add(pid);
      peakRssBytes = Math.max(peakRssBytes, pids.reduce((sum, pid) => sum + (table.get(pid)?.rssBytes ?? 0), 0));
      let descriptors = 0;
      for (const pid of pids) descriptors += await descriptorCount(pid);
      peakOpenFileDescriptors = Math.max(peakOpenFileDescriptors, descriptors);
    } finally {
      sampling = false;
    }
  };
  await sample();
  const interval = setInterval(() => {
    if (samplingError !== undefined) return;
    void sample().catch((error) => { samplingError ??= error; });
  }, 100);
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  clearInterval(interval);
  while (sampling) await new Promise((resolveWait) => setImmediate(resolveWait));
  if (code !== 0) throw new Error(`quality command exited ${String(code)}\n${stdout}\n${stderr}`);
  if (samplingError !== undefined) {
    throw new Error('process resource sampling failed', { cause: samplingError });
  }
  const table = await processTable();
  const survivors = [...observed].filter((pid) => table.has(pid));
  let leakedFileDescriptors = 0;
  for (const pid of survivors) leakedFileDescriptors += await descriptorCount(pid);
  return {
    peakRssBytes,
    peakOpenFileDescriptors,
    leakedProcesses: survivors.length,
    leakedFileDescriptors,
  };
}

async function processTable() {
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss=']);
  const table = new Map();
  for (const line of stdout.split('\n')) {
    const [pid, ppid, rss] = line.trim().split(/\s+/u).map(Number);
    if (Number.isSafeInteger(pid) && Number.isSafeInteger(ppid) && Number.isFinite(rss)) {
      table.set(pid, { ppid, rssBytes: rss * 1024 });
    }
  }
  return table;
}

function descendants(rootPid, table) {
  const found = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, entry] of table) {
      if (!found.has(pid) && found.has(entry.ppid)) {
        found.add(pid);
        changed = true;
      }
    }
  }
  return [...found];
}

async function descriptorCount(pid) {
  if (process.platform === 'linux') {
    try { return (await readdir(`/proc/${pid}/fd`)).length; }
    catch (error) {
      if (!(await processExists(pid))) return 0;
      throw new Error(`cannot observe descriptors for live process ${pid}`, { cause: error });
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execute('lsof', ['-a', '-p', String(pid), '-Fn']);
      return stdout.split('\n').filter((line) => /^f\d/u.test(line)).length;
    } catch (error) {
      if (!(await processExists(pid))) return 0;
      throw new Error(`cannot observe descriptors for live process ${pid}`, { cause: error });
    }
  }
  throw new Error(`descriptor observation is unsupported on ${process.platform}`);
}

async function processExists(pid) {
  return (await processTable()).has(pid);
}

async function directories(path) {
  try { return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith('run_')).map((entry) => entry.name); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
}

async function manifests(names) {
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(runsDir, name, 'manifest.json'), 'utf8'))));
}

function observation(value, unit, source) { return { value, unit, source }; }
function average(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function parseArgs(argv) {
  const options = { cycles: 10, output: 'performance-quality.json', environmentFile: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--cycles') options.cycles = Number(value);
    else if (name === '--output') options.output = value;
    else if (name === '--environment-file') options.environmentFile = value;
    else throw new Error(`unknown option ${String(name)}`);
    index += 1;
  }
  if (!Number.isSafeInteger(options.cycles) || options.cycles < 2 || options.cycles > 100) throw new Error('--cycles must be 2..100');
  if (!options.output) throw new Error('--output requires a path');
  if (!options.environmentFile) throw new Error('--environment-file requires a measured runner descriptor');
  return options;
}
