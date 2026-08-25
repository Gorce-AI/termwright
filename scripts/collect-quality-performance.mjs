import { spawn, execFile } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePerformanceEnvironment } from './performance-environment.mjs';
import {
  createQualityCheckpoint,
  publishQualityTerminal,
  qualityCheckpointEnvironment,
  waitForQualityReady,
} from './quality-performance-checkpoint.mjs';
import {
  parseDarwinFootprint,
  parseDarwinOpenFileDescriptors,
  parseProcessTable,
  sameProcessGeneration,
  sameProcessIdentity,
  sameProcessSet,
} from './test-support/process-resource-observation.mjs';

const execute = promisify(execFile);
const RESOURCE_SAMPLE_DEADLINE_MS = 5_000;
const CHECKPOINT_SNAPSHOT_DEADLINE_MS = 25_000;
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
const stressCheckpoint = await createQualityCheckpoint(16);
let stress;
try {
  stress = await observe([
    'packages/termwright-cli/dist/bin.js', 'test', '--resource-profile', 'stress', '--json', '--',
    '--config', 'quality/stress/vitest.config.ts', '--run', 'quality/stress/terminal-concurrency.test.ts',
  ], stressCheckpoint);
} finally {
  await rm(stressCheckpoint.directory, { recursive: true, force: true });
}
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
  resourceSnapshot: {
    kind: 'termwright-quality-resource-snapshot',
    schemaVersion: 1,
    memoryMeasurement: process.platform === 'darwin'
      ? 'darwin-summary-footprint'
      : 'linux-proportional-set-size',
    stress: {
      expectedSessions: stressCheckpoint.expectedSessions,
      processCount: stress.checkpointProcessCount,
    },
  },
  metrics: {
    startupMs: observation(firstAttemptAt - first.startedAt, 'milliseconds', 'quality/soak first run: manifest start to first attempt'),
    perTestOverheadMs: observation(
      average(orderedSoak.slice(1).map((manifest) =>
        manifest.finishedAt - manifest.startedAt
        - manifest.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0))),
      'milliseconds',
      `quality/soak ${args.cycles - 1} post-startup runs: collection and finalization time outside the test attempt`,
    ),
    peakMemoryFootprintBytes: observation(
      Math.max(soak.peakMemoryFootprintBytes, stress.peakMemoryFootprintBytes),
      'bytes',
      'maximum sampled aggregate physical footprint of the certified host process tree across soak and stress; stress includes a 16-session ready/sample/ack snapshot',
    ),
    peakOpenFileDescriptors: observation(Math.max(soak.peakOpenFileDescriptors, stress.peakOpenFileDescriptors), 'count', 'maximum open descriptors in the certified host process tree across soak and stress'),
    leakedFileDescriptors: observation(leakedFileDescriptors, 'count', 'descriptors owned by observed descendants still alive after certified host exit'),
    leakedProcesses: observation(leakedProcesses, 'count', 'observed descendants still alive after certified host exit'),
  },
};
await writeFile(resolve(args.output), `${JSON.stringify(observations, null, 2)}\n`, 'utf8');
process.stdout.write(`quality performance observations written to ${args.output}\n`);

async function observe(nodeArgs, checkpoint) {
  const child = spawn(process.execPath, nodeArgs, {
    cwd: root,
    env: {
      ...process.env,
      TERMWRIGHT_RETRIES: '0',
      ...(checkpoint === undefined ? {} : qualityCheckpointEnvironment(checkpoint)),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.pid === undefined) throw new Error('measurement child did not receive a pid');
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closePromise = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  const checkpointAbort = new AbortController();
  const closedBeforeReady = new Error('quality command exited before publishing its ready checkpoint');
  child.once('close', () => checkpointAbort.abort(closedBeforeReady));
  let peakMemoryFootprintBytes = 0;
  let peakOpenFileDescriptors = 0;
  const observed = new Map();
  let memorySampling;
  let descriptorSampling;
  let discoverySampling;
  let memorySamplingError;
  let descriptorSamplingError;
  let discoverySamplingError;
  let checkpointProcessCount;
  const discoverProcesses = async (required = false, signal) => {
    if (discoverySampling !== undefined) {
      if (!required) return undefined;
      await discoverySampling;
    }
    const operation = (async () => {
      const table = await processTable(signal);
      const pids = descendants(child.pid, table);
      rememberProcesses(observed, pids, table);
      return { pids, table };
    })();
    discoverySampling = operation;
    try {
      return await operation;
    } finally {
      if (discoverySampling === operation) discoverySampling = undefined;
    }
  };
  const sampleMemory = async (required = false, signal) => {
    if (memorySampling !== undefined) {
      if (!required) return undefined;
      await memorySampling;
    }
    const operation = (async () => {
      const table = await processTable(signal);
      const pids = descendants(child.pid, table);
      rememberProcesses(observed, pids, table);
      const footprint = await memoryFootprint(pids, table, required, signal);
      if (footprint !== undefined) peakMemoryFootprintBytes = Math.max(peakMemoryFootprintBytes, footprint);
      return { pids, table, footprint };
    })();
    memorySampling = operation;
    try {
      return await operation;
    } finally {
      if (memorySampling === operation) memorySampling = undefined;
    }
  };
  const sampleDescriptors = async (required = false, signal) => {
    if (descriptorSampling !== undefined) {
      if (!required) return undefined;
      await descriptorSampling;
    }
    const operation = (async () => {
      const table = await processTable(signal);
      const pids = descendants(child.pid, table);
      rememberProcesses(observed, pids, table);
      const descriptors = await descriptorCount(pids, table, required, signal);
      if (descriptors !== undefined) peakOpenFileDescriptors = Math.max(peakOpenFileDescriptors, descriptors);
      return { pids, table, descriptors };
    })();
    descriptorSampling = operation;
    try {
      return await operation;
    } finally {
      if (descriptorSampling === operation) descriptorSampling = undefined;
    }
  };
  await Promise.all([
    discoverProcesses().catch((error) => { discoverySamplingError ??= error; }),
    sampleMemory().catch((error) => { memorySamplingError ??= error; }),
    sampleDescriptors().catch((error) => { descriptorSamplingError ??= error; }),
  ]);
  const discoveryInterval = setInterval(() => {
    if (discoverySamplingError !== undefined) return;
    void discoverProcesses().catch((error) => { discoverySamplingError ??= error; });
  }, 25);
  const memoryInterval = setInterval(() => {
    if (memorySamplingError !== undefined) return;
    void sampleMemory().catch((error) => { memorySamplingError ??= error; });
  }, 100);
  const descriptorInterval = setInterval(() => {
    if (descriptorSamplingError !== undefined) return;
    void sampleDescriptors().catch((error) => { descriptorSamplingError ??= error; });
  }, 100);
  const checkpointTask = checkpoint === undefined ? undefined : (async () => {
    try {
      const ready = await waitForQualityReady(checkpoint, { signal: checkpointAbort.signal });
      const snapshotSignal = AbortSignal.timeout(CHECKPOINT_SNAPSHOT_DEADLINE_MS);
      clearInterval(discoveryInterval);
      clearInterval(memoryInterval);
      clearInterval(descriptorInterval);
      await Promise.all([discoverySampling, memorySampling, descriptorSampling]);
      if (discoverySamplingError !== undefined || memorySamplingError !== undefined || descriptorSamplingError !== undefined) {
        throw new AggregateError(
          [discoverySamplingError, memorySamplingError, descriptorSamplingError]
            .filter((error) => error !== undefined),
          'pre-checkpoint process resource sampling failed',
        );
      }
      const discovery = await discoverProcesses(true, snapshotSignal);
      const memory = await sampleMemory(true, snapshotSignal);
      const descriptors = await sampleDescriptors(true, snapshotSignal);
      const processCount = memory?.pids.length ?? 0;
      if (processCount < checkpoint.expectedSessions + 2) {
        throw new Error(
          `ready checkpoint claimed ${checkpoint.expectedSessions} sessions but the owned tree contained only ${processCount} processes`,
        );
      }
      if (descriptors === undefined || descriptors.descriptors === undefined ||
          descriptors.pids.length < checkpoint.expectedSessions + 2) {
        throw new Error('descriptor snapshot did not cover the complete ready process tree');
      }
      const confirmation = await discoverProcesses(true, snapshotSignal);
      if (discovery === undefined || memory === undefined || confirmation === undefined ||
          !sameProcessSet(discovery, memory) || !sameProcessSet(memory, descriptors) ||
          !sameProcessSet(descriptors, confirmation)) {
        throw new Error('ready checkpoint process set changed across discovery, footprint and descriptor snapshots');
      }
      if (ready.processPids.some((pid) => !confirmation.pids.includes(pid))) {
        throw new Error('ready checkpoint application process set is not owned by the stable process tree');
      }
      rememberProcesses(observed, confirmation.pids, confirmation.table);
      checkpointProcessCount = processCount;
      await publishQualityTerminal(checkpoint, { status: 'ok', processCount });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try { await publishQualityTerminal(checkpoint, { status: 'failure', message }); }
      catch (publishError) {
        throw new AggregateError([error, publishError], 'quality snapshot and failure publication both failed', { cause: error });
      }
      throw error;
    }
  })();
  // Attach rejection handling immediately; the authoritative await remains
  // below after the failure record has released fixture-owned sessions.
  void checkpointTask?.catch(() => undefined);
  let code;
  let closeError;
  try {
    code = await closePromise;
  } catch (error) {
    closeError = error;
    checkpointAbort.abort(error);
  } finally {
    clearInterval(discoveryInterval);
    clearInterval(memoryInterval);
    clearInterval(descriptorInterval);
    // A failed sampler must not bypass the authoritative checkpoint await,
    // which releases fixture-owned sessions through its terminal record.
    await Promise.allSettled([discoverySampling, memorySampling, descriptorSampling]);
  }
  let checkpointError;
  try {
    if (checkpointTask !== undefined) await checkpointTask;
  } catch (error) {
    checkpointError = error;
  }
  if (closeError !== undefined || checkpointError !== undefined) {
    throw new AggregateError(
      [closeError, checkpointError].filter((error) => error !== undefined),
      'quality command or its resource checkpoint failed',
    );
  }
  if (code !== 0) throw new Error(`quality command exited ${String(code)}\n${stdout}\n${stderr}`);
  if (discoverySamplingError !== undefined || memorySamplingError !== undefined || descriptorSamplingError !== undefined) {
    throw new AggregateError(
      [discoverySamplingError, memorySamplingError, descriptorSamplingError]
        .filter((error) => error !== undefined),
      'process resource sampling failed',
    );
  }
  const table = await processTable();
  const survivors = [...observed].filter(([pid, identity]) => sameProcessGeneration(identity, table.get(pid)))
    .map(([pid]) => pid);
  const leakedFileDescriptors = await descriptorCount(survivors, table, false) ?? 0;
  return {
    peakMemoryFootprintBytes,
    peakOpenFileDescriptors,
    leakedProcesses: survivors.length,
    leakedFileDescriptors,
    checkpointProcessCount,
  };
}

async function processTable(signal) {
  const operationSignal = signal ?? AbortSignal.timeout(RESOURCE_SAMPLE_DEADLINE_MS);
  const { stdout } = await execute('ps', ['-axww', '-o', 'pid=,ppid=,lstart=,command='], {
    signal: operationSignal,
  });
  return parseProcessTable(stdout);
}

async function memoryFootprint(pids, table, required, signal) {
  const operationSignal = signal ?? AbortSignal.timeout(RESOURCE_SAMPLE_DEADLINE_MS);
  if (process.platform === 'darwin') {
    const footprintArgs = ['-f', 'bytes', ...pids.flatMap((pid) => ['-p', String(pid)])];
    let stdout;
    try {
      ({ stdout } = await execute('/usr/bin/footprint', footprintArgs, {
        maxBuffer: 16 * 1024 * 1024,
        signal: operationSignal,
      }));
    } catch (error) {
      if (!required && await processSetChanged(pids, table, operationSignal)) return undefined;
      throw new Error('cannot observe physical footprint for the live process tree', { cause: error });
    }
    try {
      const footprint = parseDarwinFootprint(stdout, pids);
      if (await processSetChanged(pids, table, operationSignal)) {
        if (!required) return undefined;
        throw new Error('process identity changed while footprint was measured');
      }
      return footprint;
    } catch (error) {
      if (!required && await processSetChanged(pids, table, operationSignal)) return undefined;
      throw error;
    }
  }
  if (process.platform === 'linux') {
    try {
      const values = await Promise.all(pids.map(async (pid) => {
        const rollup = await readFile(`/proc/${pid}/smaps_rollup`, {
          encoding: 'utf8',
          signal: operationSignal,
        });
        const match = /^Pss:\s+(\d+) kB\s*$/mu.exec(rollup);
        const kibibytes = Number(match?.[1]);
        if (!Number.isSafeInteger(kibibytes) || kibibytes < 0) {
          throw new Error(`smaps_rollup for pid ${pid} has no valid Pss`);
        }
        return kibibytes * 1024;
      }));
      if (await processSetChanged(pids, table, operationSignal)) {
        if (!required) return undefined;
        throw new Error('process identity changed while proportional memory was measured');
      }
      return values.reduce((sum, value) => sum + value, 0);
    } catch (error) {
      if (!required && await processSetChanged(pids, table, operationSignal)) return undefined;
      throw new Error('cannot observe proportional memory footprint for the live process tree', { cause: error });
    }
  }
  throw new Error(`memory footprint observation is unsupported on ${process.platform}`);
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

function rememberProcesses(observed, pids, table) {
  for (const pid of pids) {
    const identity = table.get(pid);
    if (identity !== undefined) observed.set(pid, identity);
  }
}

async function descriptorCount(pids, table, required, signal) {
  if (pids.length === 0) return 0;
  const operationSignal = signal ?? AbortSignal.timeout(RESOURCE_SAMPLE_DEADLINE_MS);
  if (process.platform === 'linux') {
    try {
      const counts = await Promise.all(pids.map(async (pid) => (
        await awaitWithSignal(readdir(`/proc/${pid}/fd`), operationSignal)
      ).length));
      if (await processSetChanged(pids, table, operationSignal)) {
        if (!required) return undefined;
        throw new Error('process identity changed while descriptors were measured');
      }
      return counts.reduce((sum, count) => sum + count, 0);
    } catch (error) {
      if (!required && await processSetChanged(pids, table, operationSignal)) return undefined;
      throw new Error('cannot observe descriptors for the live process tree', { cause: error });
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execute('lsof', ['-a', '-p', pids.join(','), '-Fn'], {
        signal: operationSignal,
      });
      const descriptors = parseDarwinOpenFileDescriptors(stdout, pids);
      if (await processSetChanged(pids, table, operationSignal)) {
        if (!required) return undefined;
        throw new Error('process identity changed while descriptors were measured');
      }
      return descriptors;
    } catch (error) {
      if (!required && await processSetChanged(pids, table, operationSignal)) return undefined;
      throw new Error('cannot observe descriptors for the live process tree', { cause: error });
    }
  }
  throw new Error(`descriptor observation is unsupported on ${process.platform}`);
}

async function processSetChanged(pids, table, signal) {
  const current = await processTable(signal);
  return pids.some((pid) => !sameProcessIdentity(table.get(pid), current.get(pid)));
}

async function awaitWithSignal(promise, signal) {
  if (signal.aborted) throw signal.reason ?? new Error('resource observation aborted');
  return await new Promise((resolveValue, reject) => {
    const onAbort = () => finish(reject, signal.reason ?? new Error('resource observation aborted'));
    const finish = (action, value) => {
      signal.removeEventListener('abort', onAbort);
      action(value);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(resolveValue, value),
      (error) => finish(reject, error),
    );
    if (signal.aborted) onAbort();
  });
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
