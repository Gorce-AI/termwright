import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const installRoot = resolve(process.argv[2] ?? process.cwd());
const project = await mkdtemp(join(installRoot, 'termwright-long-run-'));
const shortMs = duration(process.env['TERMWRIGHT_LONG_RUN_SHORT_MS'] ?? '15000', 'short');
const longMs = duration(process.env['TERMWRIGHT_LONG_RUN_MS'] ?? '180000', 'long');
if (longMs < shortMs * 4) throw new Error('long duration must be at least four times short');

try {
  await Promise.all([
    write('package.json', JSON.stringify({ private: true, type: 'module' }, null, 2)),
    write(
      'app.mjs',
      `import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import {useSemantic} from '@termwright/ink';

const durationMs = Number(process.argv[2]);
function Dashboard() {
  const [frame, setFrame] = useState(0);
  const [done, setDone] = useState(false);
  const ref = useRef(null);
  const {exit} = useApp();
  useSemantic(ref, {role: 'status', name: done ? 'Complete' : 'Running', testId: 'progress'});
  useInput((input) => { if (done && input === 'q') exit(); });
  useEffect(() => {
    const started = performance.now();
    let active = true;
    const tick = () => {
      if (!active) return;
      if (performance.now() - started >= durationMs) { setDone(true); return; }
      setFrame((value) => value + 1);
      setTimeout(tick, 16);
    };
    tick();
    return () => { active = false; };
  }, []);
  const payload = String(frame).padStart(8, '0') + ':' + 'x'.repeat(960);
  return React.createElement(Box, {ref, flexDirection: 'column'},
    React.createElement(Text, null, done ? 'COMPLETE' : 'RUNNING'),
    React.createElement(Text, null, payload));
}

const instance = render(React.createElement(Dashboard), {alternateScreen: true, interactive: true});
await instance.waitUntilExit();
`,
    ),
    write(
      'setup.mjs',
      `import {configureTermwright} from 'termwright/test';
configureTermwright({columns: 100, rows: 8, outputDir: 'artifacts', trace: 'on', requiredCapabilities: ['semantic-tree', 'paired-revisions']});
`,
    ),
    write(
      'vitest.config.mjs',
      `import {defineConfig} from 'vitest/config';
export default defineConfig({test: {include: ['long-run.test.mjs'], setupFiles: ['./setup.mjs'], testTimeout: ${longMs + 60000}}});
`,
    ),
    write(
      'long-run.test.mjs',
      `import {fileURLToPath} from 'node:url';
import {expect, test} from 'termwright/test';
import {withProbe} from '@termwright/probe-ink';
const program = fileURLToPath(new URL('./app.mjs', import.meta.url));
for (const [label, durationMs] of [['short', ${shortMs}], ['long', ${longMs}]]) {
  test.resources({terminals: 1, traceWriters: 1, load: 'heavy'})(label + ' real Ink trace', async ({terminal}) => {
    const command = withProbe('node', [process.execPath, program, String(durationMs)]).command;
    const app = await terminal.launch({command});
    await expect(app.getByRole('status', {name: 'Complete'})).toBeAttached({timeout: durationMs + 30000});
    await app.press('q');
    expect((await app.exit).code).toBe(0);
  });
}
`,
    ),
  ]);

  const cli = join(installRoot, 'node_modules', 'termwright', 'dist', 'bin.js');
  const execution = await execute(process.execPath, [cli, 'test', '--', '--run'], {
    cwd: project,
    env: {
      ...process.env,
      TERMWRIGHT_RETRIES: '0',
      TERMWRIGHT_UPDATE_SNAPSHOTS: 'none',
    },
    timeout: shortMs + longMs + 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const runDirectories = await readdir(join(project, '.termwright', 'runs'));
  if (runDirectories.length !== 1)
    throw new Error(`long-run host wrote ${runDirectories.length} run directories`);
  const runDir = join(project, '.termwright', 'runs', runDirectories[0]);
  const [manifest, eventBody] = await Promise.all([
    readFile(join(runDir, 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(join(runDir, 'events.ndjson'), 'utf8'),
  ]);
  if (manifest.v !== 7 || manifest.status !== 'passed')
    throw new Error(`long-run manifest failed: ${JSON.stringify(manifest)}`);
  const events = eventBody.trimEnd().split('\n').map(JSON.parse);
  const evidence = Object.fromEntries(
    ['short real Ink trace', 'long real Ink trace'].map((name) => {
      const spec = manifest.specs.find((candidate) => candidate.fullName === name);
      if (!spec) throw new Error(`long-run manifest lacks ${name}`);
      const attempt = manifest.attempts.find(
        (candidate) => candidate.runnerTaskId === spec.runnerTaskId,
      );
      if (!attempt) throw new Error(`long-run manifest lacks attempt for ${name}`);
      const finish = events.find(
        (event) =>
          event.type === 'attempt.finished' && event.identity.attemptId === attempt.attemptId,
      );
      const trace = events.find(
        (event) =>
          event.type === 'trace.resource' && event.identity.attemptId === attempt.attemptId,
      );
      if (!finish?.payload?.worker || !trace?.payload)
        throw new Error(`long-run manifest lacks resource evidence for ${name}`);
      return [
        name.startsWith('short') ? 'short' : 'long',
        { worker: finish.payload.worker, trace: trace.payload },
      ];
    }),
  );
  const growth = longMs / shortMs;
  for (const metric of [
    'terminalOutputBytes',
    'semanticBytes',
    'semanticDeltaCount',
    'traceBytes',
  ]) {
    if (evidence.long.trace[metric] < evidence.short.trace[metric] * growth * 0.5) {
      throw new Error(`${metric} did not scale with the longer workload`);
    }
  }
  const rssGrowth =
    evidence.long.worker.peakSampledRssBytes - evidence.short.worker.peakSampledRssBytes;
  const result = {
    status: rssGrowth <= 96 * 1024 * 1024 ? 'PASS' : 'FAIL',
    runtime: { platform: process.platform, arch: process.arch, node: process.version },
    durationsMs: { short: shortMs, long: longMs },
    rssGrowthBytes: rssGrowth,
    evidence,
  };
  process.stderr.write(execution.stdout);
  process.stderr.write(execution.stderr);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'PASS') process.exitCode = 1;
} catch (error) {
  console.log(
    JSON.stringify(
      {
        status: 'FAIL',
        runtime: { platform: process.platform, arch: process.arch, node: process.version },
        durationsMs: { short: shortMs, long: longMs },
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await rm(project, { recursive: true, force: true });
}

function duration(raw, label) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1000 || value > 15 * 60 * 1000)
    throw new Error(`${label} duration must be an integer from 1000 through 900000 ms`);
  return value;
}

function write(name, body) {
  return writeFile(join(project, name), `${body}\n`, 'utf8');
}
