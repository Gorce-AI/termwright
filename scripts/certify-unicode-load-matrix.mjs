import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const probe = fileURLToPath(new URL('./unicode-load-probe.mjs', import.meta.url));
const config = fileURLToPath(new URL('./unicode-load-vitest.config.mjs', import.meta.url));
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const termwright = fileURLToPath(
  new URL('../packages/termwright-cli/dist/bin.js', import.meta.url),
);
const watchdogMs = 8_000;

async function stopProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function runScenario(scenario) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, scenario.args, {
      cwd: root,
      detached: process.platform !== 'win32',
      env: { ...process.env, ...scenario.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    const watchdog = setTimeout(async () => {
      await stopProcessTree(child);
      resolve({
        name: scenario.name,
        status: 'timeout',
        watchdogMs,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    }, watchdogMs);
    child.once('exit', (code, signal) => {
      clearTimeout(watchdog);
      resolve({
        name: scenario.name,
        status: code === 0 ? 'pass' : 'fail',
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function vitestScenario(candidate, pool, viteModuleRunner) {
  return {
    name: `${candidate}-vitest-${pool}-vite-runner-${viteModuleRunner ? 'on' : 'off'}`,
    args: [vitest, 'run', '--config', config],
    env: {
      TERMWRIGHT_UNICODE_CANDIDATE: candidate,
      TERMWRIGHT_UNICODE_POOL: pool,
      TERMWRIGHT_UNICODE_VITE_RUNNER: viteModuleRunner ? 'on' : 'off',
    },
  };
}

function candidateScenarios(candidate) {
  return [
    {
      name: `${candidate}-plain-node-clean-pool`,
      args: [probe],
      env: { TERMWRIGHT_UNICODE_CANDIDATE: candidate },
    },
    {
      name: `${candidate}-plain-node-dirty-pool`,
      args: [probe, '--dirty-buffer-pool'],
      env: { TERMWRIGHT_UNICODE_CANDIDATE: candidate },
    },
    vitestScenario(candidate, 'threads', true),
    vitestScenario(candidate, 'forks', true),
    vitestScenario(candidate, 'threads', false),
    vitestScenario(candidate, 'forks', false),
  ];
}

const scenarios = [
  ...candidateScenarios('xterm-upstream'),
  ...candidateScenarios('xterm-fixed-trie-model'),
  ...candidateScenarios('termwright-owned'),
  {
    name: 'termwright-owned-native-host',
    args: [termwright, 'test', '--resource-profile', 'local', '--', '--config', config],
    env: {
      TERMWRIGHT_UNICODE_CANDIDATE: 'termwright-owned',
      TERMWRIGHT_UNICODE_POOL: 'forks',
      TERMWRIGHT_UNICODE_VITE_RUNNER: 'on',
    },
  },
];

const results = [];
for (const scenario of scenarios) results.push(await runScenario(scenario));

process.stdout.write(
  `${JSON.stringify({ node: process.version, watchdogMs, results }, null, 2)}\n`,
);

const upstream = results.filter((result) => result.name.startsWith('xterm-upstream-'));
const fixed = results.filter((result) => result.name.startsWith('xterm-fixed-trie-model-'));
const owned = results.filter((result) => result.name.startsWith('termwright-owned-'));
if (upstream.every((result) => result.status === 'pass')) {
  throw new Error(
    'Pinned xterm grapheme candidate no longer reproduces the pooled-Buffer defect. Re-certify upstream instead of retaining a stale patch model.',
  );
}
if (fixed.some((result) => result.status !== 'pass')) {
  throw new Error(
    'The fixed-trie control must pass every runtime lane; the defect is not isolated.',
  );
}
if (owned.some((result) => result.status !== 'pass')) {
  throw new Error('The Termwright-owned provider must pass every runtime lane.');
}
