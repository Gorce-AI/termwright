import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
      `import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Box, Text, measureElement, render, useApp, useInput, useStdout} from 'ink';
import {useSemantic} from '@termwright/ink';
import {registerPointerEvidenceProvider} from '@termwright/evidence-provider';

const durationMs = Number(process.argv[2]);
let activateElement = null;
registerPointerEvidenceProvider({
  id: 'clean-room-ink-pointer',
  version: '1.0.0',
  method: 'native',
  family: 'pointer',
  capabilities: ['pointer-regions', 'hit-test'],
  observe: ({columns, rows}) => {
    if (activateElement === null) return {pointerRegions: [], hitTest: () => null};
    const box = measureElement(activateElement);
    const top = Math.max(0, box.y);
    const bottom = Math.min(rows, box.y + box.height);
    const left = Math.max(0, box.x);
    const right = Math.min(columns, box.x + box.width);
    if (bottom <= top || right <= left) return {pointerRegions: [], hitTest: () => null};
    const bounds = {row: top, column: left, width: right - left, height: bottom - top};
    const inside = (column, row) =>
      column >= bounds.column && column < Math.min(columns, bounds.column + bounds.width) &&
      row >= bounds.row && row < Math.min(rows, bounds.row + bounds.height);
    return {
      pointerRegions: [{
        recipient: {testId: 'activate'},
        regionBounds: bounds,
        spans: Array.from({length: bounds.height}, (_, offset) => ({
          row: bounds.row + offset,
          from: bounds.column,
          to: bounds.column + bounds.width,
        })),
      }],
      hitTest: (column, row) => inside(column, row) ? {testId: 'activate'} : null,
    };
  },
});

const SGR_MOUSE = /\\u001B?\\[<(\\d+);(\\d+);(\\d+)([Mm])/u;
function Dashboard() {
  const [frame, setFrame] = useState(0);
  const [done, setDone] = useState(false);
  const [activated, setActivated] = useState(false);
  const statusRef = useRef(null);
  const activateRef = useRef(null);
  const {exit} = useApp();
  const {stdout} = useStdout();
  useSemantic(statusRef, {role: 'status', name: activated ? 'Activated' : done ? 'Complete' : 'Running', testId: 'progress'});
  useSemantic(activateRef, {role: 'button', name: 'Activate', testId: 'activate'});
  useLayoutEffect(() => {
    activateElement = activateRef.current;
    return () => { if (activateElement === activateRef.current) activateElement = null; };
  });
  useEffect(() => {
    stdout.write('\\u001B[?1000h\\u001B[?1006h');
    return () => stdout.write('\\u001B[?1006l\\u001B[?1000l');
  }, [stdout]);
  useInput((input) => {
    const mouse = SGR_MOUSE.exec(input);
    if (mouse !== null) {
      if (mouse[4] !== 'M' || Number(mouse[1]) !== 0 || activateElement === null) return;
      const box = measureElement(activateElement);
      const column = Number(mouse[2]) - 1;
      const row = Number(mouse[3]) - 1;
      if (column >= box.x && column < box.x + box.width && row >= box.y && row < box.y + box.height) setActivated(true);
      return;
    }
    if (done && input === 'q') exit();
  });
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
  const payload = Array.from({length: 4}, (_, row) =>
    String(frame).padStart(8, '0') + ':' + row + ':' + 'x'.repeat(85));
  return React.createElement(Box, {flexDirection: 'column'},
    ...payload.map((line, row) => React.createElement(Text, {key: row}, line)),
    React.createElement(Box, null,
      React.createElement(Text, null, '👨‍👩‍👧 '),
      React.createElement(Box, {ref: activateRef}, React.createElement(Text, null, '[Activate]'))),
    React.createElement(Text, null, '👍🏽 🇵🇱 किं 각 世'),
    React.createElement(Box, {ref: statusRef}, React.createElement(Text, null, activated ? 'ACTIVATED' : done ? 'COMPLETE' : 'RUNNING')));
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
    const target = app.getByRole('button', {name: 'Activate'});
    const semantic = await target.resolve();
    const visual = await app.getByScreenText('[Activate]').resolve();
    expect(visual.rect).toEqual(semantic.rect);
    expect(semantic.rect).toMatchObject({column: 3, width: 10, height: 1});
    const click = await target.click();
    expect(click.executed.map((operation) => operation.device + ':' + operation.kind)).toEqual(['mouse:down', 'mouse:up']);
    await expect(app.getByRole('status', {name: 'Activated'})).toBeAttached();
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
  if (manifest.v !== 8 || manifest.status !== 'passed')
    throw new Error(`long-run manifest failed: ${JSON.stringify(manifest)}`);
  const traces = await findTraces(project);
  if (traces.length !== 2) throw new Error(`long-run run produced ${traces.length} traces`);
  const screenshot = join(project, 'unicode-replay.png');
  await execute(
    process.execPath,
    [cli, 'screenshot', '--trace', traces[0], '--at', '500', '--out-file', screenshot],
    {
      cwd: project,
      timeout: 30_000,
    },
  );
  const screenshotBytes = (await stat(screenshot)).size;
  if (screenshotBytes < 100) throw new Error('Unicode replay screenshot is empty');
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
    unicode: {
      semanticAndScreenGeometry: 'PASS',
      pointerClick: 'PASS',
      replayScreenshotBytes: screenshotBytes,
    },
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

async function findTraces(directory) {
  const traces = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith('.twtrace')) traces.push(path);
    else traces.push(...(await findTraces(path)));
  }
  return traces.sort();
}
