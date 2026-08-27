import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePerformanceEnvironment } from './performance-environment.mjs';
import { summarizeQualityTiming } from './quality-performance-timing.mjs';
import {
  readRunManifest,
  RUN_HISTORY_COMMIT_VERSION,
  runDirectoryName,
} from '../packages/run-history/dist/index.js';
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

const soakArgs = [
  'packages/termwright-cli/dist/bin.js',
  'test',
  '--runs',
  String(args.cycles),
  '--resource-profile',
  'ci',
  '--json',
  '--',
  '--config',
  'quality/soak/vitest.config.ts',
  '--run',
  'quality/soak/terminal-cycle.test.ts',
];
const timingRunIds = await observeTiming(soakArgs, args.cycles);
const resourceSoak = await observeResources(soakArgs, undefined, args.cycles);
const stressCheckpoint = await createQualityCheckpoint(16);
let stress;
try {
  stress = await observeResources(
    [
      'packages/termwright-cli/dist/bin.js',
      'test',
      '--resource-profile',
      'stress',
      '--json',
      '--',
      '--config',
      'quality/stress/vitest.config.ts',
      '--run',
      'quality/stress/terminal-concurrency.test.ts',
    ],
    stressCheckpoint,
    1,
  );
} finally {
  await rm(stressCheckpoint.directory, { recursive: true, force: true });
}

const timingRecords = await manifests(timingRunIds);
const resourceSoakRecords = await manifests(resourceSoak.runIds);
const stressRecords = await manifests(stress.runIds);
const timingManifests = timingRecords.map((record) => record.manifest);
const resourceSoakManifests = resourceSoakRecords.map((record) => record.manifest);
const stressManifests = stressRecords.map((record) => record.manifest);
if (timingManifests.length !== args.cycles || resourceSoakManifests.length !== args.cycles) {
  throw new Error(
    `expected ${args.cycles} timing and resource soak manifests, observed ${timingManifests.length} and ${resourceSoakManifests.length}`,
  );
}
if (stressManifests.length !== 1) {
  throw new Error(`expected one stress manifest, observed ${stressManifests.length}`);
}
const timing = summarizeQualityTiming(timingManifests);
const provenance = await qualityProvenance({
  timing: timingRecords,
  resourceSoak: resourceSoakRecords,
  stress: stressRecords,
});

const observations = {
  generatedAt: new Date().toISOString(),
  environment,
  provenance,
  resourceSnapshot: {
    kind: 'termwright-quality-resource-snapshot',
    schemaVersion: 1,
    memoryMeasurement:
      process.platform === 'darwin' ? 'darwin-summary-footprint' : 'linux-proportional-set-size',
    stress: {
      expectedSessions: stressCheckpoint.expectedSessions,
      processCount: stress.checkpointProcessCount,
    },
  },
  metrics: {
    firstRunPreAttemptMs: observation(
      timing.firstRunPreAttemptMs,
      'milliseconds',
      'quality/soak first run: host-monotonic run start to first attempt',
    ),
    postStartupRunOrchestrationMs: observation(
      timing.postStartupRunOrchestrationMs,
      'milliseconds',
      `quality/soak ${args.cycles - 1} post-startup runs: host-monotonic collection, scheduling and finalization outside the test attempt`,
    ),
    peakMemoryFootprintBytes: observation(
      Math.max(resourceSoak.peakMemoryFootprintBytes, stress.peakMemoryFootprintBytes),
      'bytes',
      'maximum sampled aggregate physical footprint across the separately instrumented lifecycle soak and certified 16-session stress tree',
    ),
    peakOpenFileDescriptors: observation(
      Math.max(resourceSoak.peakOpenFileDescriptors, stress.peakOpenFileDescriptors),
      'count',
      'maximum open descriptors across the separately instrumented lifecycle soak and certified stress tree',
    ),
    leakedFileDescriptors: observation(
      resourceSoak.leakedFileDescriptors + stress.leakedFileDescriptors,
      'count',
      'descriptors owned by observed lifecycle or stress descendants still alive after certified host exit',
    ),
    leakedProcesses: observation(
      resourceSoak.leakedProcesses + stress.leakedProcesses,
      'count',
      'observed lifecycle or stress descendants still alive after certified host exit',
    ),
  },
};
await writeFile(resolve(args.output), `${JSON.stringify(observations, null, 2)}\n`, 'utf8');
process.stdout.write(`quality performance observations written to ${args.output}\n`);

async function observeTiming(nodeArgs, expectedRuns) {
  try {
    const { stdout } = await execute(process.execPath, nodeArgs, {
      cwd: root,
      env: { ...process.env, TERMWRIGHT_RETRIES: '0' },
      maxBuffer: 16 * 1024 * 1024,
    });
    return hostReportRunIds(stdout, expectedRuns);
  } catch (error) {
    throw new Error('quality timing command failed', { cause: error });
  }
}

async function observeResources(nodeArgs, checkpoint, expectedRuns) {
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
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const closePromise = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  const checkpointAbort = new AbortController();
  const closedBeforeReady = new Error(
    'quality command exited before publishing its ready checkpoint',
  );
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
      if (footprint !== undefined)
        peakMemoryFootprintBytes = Math.max(peakMemoryFootprintBytes, footprint);
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
      if (descriptors !== undefined)
        peakOpenFileDescriptors = Math.max(peakOpenFileDescriptors, descriptors);
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
    discoverProcesses().catch((error) => {
      discoverySamplingError ??= error;
    }),
    sampleMemory().catch((error) => {
      memorySamplingError ??= error;
    }),
    sampleDescriptors().catch((error) => {
      descriptorSamplingError ??= error;
    }),
  ]);
  const discoveryInterval = setInterval(() => {
    if (discoverySamplingError !== undefined) return;
    void discoverProcesses().catch((error) => {
      discoverySamplingError ??= error;
    });
  }, 25);
  const memoryInterval = setInterval(() => {
    if (memorySamplingError !== undefined) return;
    void sampleMemory().catch((error) => {
      memorySamplingError ??= error;
    });
  }, 100);
  const descriptorInterval = setInterval(() => {
    if (descriptorSamplingError !== undefined) return;
    void sampleDescriptors().catch((error) => {
      descriptorSamplingError ??= error;
    });
  }, 100);
  const checkpointTask =
    checkpoint === undefined
      ? undefined
      : (async () => {
          try {
            const ready = await waitForQualityReady(checkpoint, { signal: checkpointAbort.signal });
            const snapshotSignal = AbortSignal.timeout(CHECKPOINT_SNAPSHOT_DEADLINE_MS);
            clearInterval(discoveryInterval);
            clearInterval(memoryInterval);
            clearInterval(descriptorInterval);
            await Promise.all([discoverySampling, memorySampling, descriptorSampling]);
            if (
              discoverySamplingError !== undefined ||
              memorySamplingError !== undefined ||
              descriptorSamplingError !== undefined
            ) {
              throw new AggregateError(
                [discoverySamplingError, memorySamplingError, descriptorSamplingError].filter(
                  (error) => error !== undefined,
                ),
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
            if (
              descriptors === undefined ||
              descriptors.descriptors === undefined ||
              descriptors.pids.length < checkpoint.expectedSessions + 2
            ) {
              throw new Error('descriptor snapshot did not cover the complete ready process tree');
            }
            const confirmation = await discoverProcesses(true, snapshotSignal);
            if (
              discovery === undefined ||
              memory === undefined ||
              confirmation === undefined ||
              !sameProcessSet(discovery, memory) ||
              !sameProcessSet(memory, descriptors) ||
              !sameProcessSet(descriptors, confirmation)
            ) {
              throw new Error(
                'ready checkpoint process set changed across discovery, footprint and descriptor snapshots',
              );
            }
            if (ready.processPids.some((pid) => !confirmation.pids.includes(pid))) {
              throw new Error(
                'ready checkpoint application process set is not owned by the stable process tree',
              );
            }
            rememberProcesses(observed, confirmation.pids, confirmation.table);
            checkpointProcessCount = processCount;
            await publishQualityTerminal(checkpoint, { status: 'ok', processCount });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            try {
              await publishQualityTerminal(checkpoint, { status: 'failure', message });
            } catch (publishError) {
              throw new AggregateError(
                [error, publishError],
                'quality snapshot and failure publication both failed',
                { cause: error },
              );
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
  if (
    discoverySamplingError !== undefined ||
    memorySamplingError !== undefined ||
    descriptorSamplingError !== undefined
  ) {
    throw new AggregateError(
      [discoverySamplingError, memorySamplingError, descriptorSamplingError].filter(
        (error) => error !== undefined,
      ),
      'process resource sampling failed',
    );
  }
  const table = await processTable();
  const survivors = [...observed]
    .filter(([pid, identity]) => sameProcessGeneration(identity, table.get(pid)))
    .map(([pid]) => pid);
  const leakedFileDescriptors = (await descriptorCount(survivors, table, false)) ?? 0;
  return {
    runIds: hostReportRunIds(stdout, expectedRuns),
    peakMemoryFootprintBytes,
    peakOpenFileDescriptors,
    leakedProcesses: survivors.length,
    leakedFileDescriptors,
    checkpointProcessCount,
  };
}

function hostReportRunIds(stdout, expectedRuns) {
  const finalLine = stdout.trim().split(/\r?\n/u).at(-1);
  let report;
  try {
    report = JSON.parse(finalLine ?? '');
  } catch (error) {
    throw new Error('quality command did not end with its JSON host report', { cause: error });
  }
  if (
    report?.state !== 'passed' ||
    report.requestedRuns !== expectedRuns ||
    report.completedRuns !== expectedRuns ||
    report.skipPolicy !== 'matched' ||
    !Array.isArray(report.runs) ||
    report.runs.length !== expectedRuns
  ) {
    throw new Error(
      'quality command host report is incomplete or not passed on its first attempts',
    );
  }
  const runIds = report.runs.map((run) => run?.runId);
  if (
    runIds.some((runId) => typeof runId !== 'string' || !/^run:[0-9a-f-]+$/u.test(runId)) ||
    new Set(runIds).size !== expectedRuns ||
    report.runs.some((run) => run?.state !== 'passed')
  ) {
    throw new Error('quality command host report contains invalid run evidence');
  }
  return runIds;
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
      if (!required && (await processSetChanged(pids, table, operationSignal))) return undefined;
      throw new Error('cannot observe physical footprint for the live process tree', {
        cause: error,
      });
    }
    try {
      const footprint = parseDarwinFootprint(stdout, pids);
      if (await processSetChanged(pids, table, operationSignal)) {
        if (!required) return undefined;
        throw new Error('process identity changed while footprint was measured');
      }
      return footprint;
    } catch (error) {
      if (!required && (await processSetChanged(pids, table, operationSignal))) return undefined;
      throw error;
    }
  }
  if (process.platform === 'linux') {
    try {
      const values = await Promise.all(
        pids.map(async (pid) => {
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
        }),
      );
      if (await processSetChanged(pids, table, operationSignal)) {
        if (!required) return undefined;
        throw new Error('process identity changed while proportional memory was measured');
      }
      return values.reduce((sum, value) => sum + value, 0);
    } catch (error) {
      if (!required && (await processSetChanged(pids, table, operationSignal))) return undefined;
      throw new Error('cannot observe proportional memory footprint for the live process tree', {
        cause: error,
      });
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
      const counts = await Promise.all(
        pids.map(
          async (pid) =>
            (await awaitWithSignal(readdir(`/proc/${pid}/fd`), operationSignal)).length,
        ),
      );
      if (await processSetChanged(pids, table, operationSignal)) {
        if (!required) return undefined;
        throw new Error('process identity changed while descriptors were measured');
      }
      return counts.reduce((sum, count) => sum + count, 0);
    } catch (error) {
      if (!required && (await processSetChanged(pids, table, operationSignal))) return undefined;
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
      if (!required && (await processSetChanged(pids, table, operationSignal))) return undefined;
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
    const onAbort = () =>
      finish(reject, signal.reason ?? new Error('resource observation aborted'));
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

async function manifests(runIds) {
  return Promise.all(
    runIds.map(async (runId) => {
      const record = await readRunManifest(runsDir, runId);
      if (
        record.state !== 'complete' ||
        record.runId !== runId ||
        record.manifest.runId !== runId
      ) {
        throw new Error(
          `quality run ${runId} has no complete committed current manifest: ${record.state}`,
        );
      }
      const directory = resolve(runsDir, runDirectoryName(runId));
      const [raw, committed] = await Promise.all([
        readFile(resolve(directory, 'manifest.json')),
        readFile(resolve(directory, 'COMMITTED'), 'utf8'),
      ]);
      const manifestSha256 = sha256(raw);
      if (
        committed.trim() !==
        `termwright-run-history-v${RUN_HISTORY_COMMIT_VERSION} sha256:${manifestSha256}`
      ) {
        throw new Error(`quality run ${runId} changed after its committed manifest was validated`);
      }
      return {
        manifest: record.manifest,
        evidence: {
          runId,
          manifestSha256,
        },
      };
    }),
  );
}

async function qualityProvenance(roles) {
  const collector = await readFile(fileURLToPath(import.meta.url));
  const { stdout } = await execute('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: root,
  });
  const gitCommit = stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(gitCommit))
    throw new Error('quality collector could not resolve one Git commit');
  return {
    kind: 'termwright-quality-provenance',
    schemaVersion: 1,
    collectorSha256: sha256(collector),
    gitCommit,
    ci: githubCiProvenance(process.env, gitCommit),
    roles: Object.fromEntries(
      Object.entries(roles).map(([role, records]) => [role, roleEvidence(role, records)]),
    ),
  };
}

function roleEvidence(role, records) {
  const invocationIds = new Set(records.map((record) => record.manifest.invocationId));
  if (records.length === 0 || invocationIds.size !== 1) {
    throw new Error(`quality ${role} evidence does not belong to one host invocation`);
  }
  return {
    invocationId: [...invocationIds][0],
    runs: records.map((record) => record.evidence),
  };
}

function githubCiProvenance(env, gitCommit) {
  if (env.GITHUB_ACTIONS !== 'true') return null;
  const runId = env.GITHUB_RUN_ID;
  const runAttempt = env.GITHUB_RUN_ATTEMPT;
  const sha = env.GITHUB_SHA;
  if (
    !/^[1-9][0-9]*$/u.test(runId ?? '') ||
    !/^[1-9][0-9]*$/u.test(runAttempt ?? '') ||
    !/^[0-9a-f]{40}$/u.test(sha ?? '') ||
    sha !== gitCommit
  ) {
    throw new Error(
      'GitHub Actions quality provenance is missing or differs from the measured Git commit',
    );
  }
  return { runId, runAttempt, sha };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function observation(value, unit, source) {
  return { value, unit, source };
}

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
  if (!Number.isSafeInteger(options.cycles) || options.cycles < 2 || options.cycles > 100)
    throw new Error('--cycles must be 2..100');
  if (!options.output) throw new Error('--output requires a path');
  if (!options.environmentFile)
    throw new Error('--environment-file requires a measured runner descriptor');
  return options;
}
