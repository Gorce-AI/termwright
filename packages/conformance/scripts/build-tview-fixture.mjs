/** Build the same zero-import tview fixture against plain and probed tview. */

import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prepareInstrumentedBuild } from '@termwright/probe-tview';

const run = promisify(execFile);
const moduleDir = fileURLToPath(new URL('../../../clients/go/', import.meta.url));
const instrumented = join(tmpdir(), 'termwright-conformance-tview');
const baseline = join(tmpdir(), 'termwright-conformance-tview-plain');

const prepared = await prepareInstrumentedBuild({ moduleDir });
await run('go', ['build', '-o', instrumented, './examples/permission'], {
  cwd: moduleDir,
  env: prepared.env,
});
await run('go', ['build', '-o', baseline, './examples/permission'], {
  cwd: moduleDir,
  env: { ...process.env, GOWORK: 'off' },
});
