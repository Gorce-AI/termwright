/**
 * Builds the Go application the tests drive.
 *
 * A missing Go toolchain is not a failure: the suite skips itself when the
 * binary is absent, so a JavaScript-only checkout still runs green.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareInstrumentedBuild } from '@termwright/probe-tview';

const root = fileURLToPath(new URL('..', import.meta.url));
const probe = spawnSync('go', ['version'], { stdio: 'ignore' });

if (probe.status !== 0) {
  console.log('tview-menu: no Go toolchain, skipping the build');
  process.exit(0);
}

mkdirSync(fileURLToPath(new URL('../dist', import.meta.url)), { recursive: true });
const prepared = await prepareInstrumentedBuild({ moduleDir: root });
const build = spawnSync('go', ['build', ...prepared.goArgs, '-o', 'dist/tview-menu', './app'], {
  cwd: root,
  env: prepared.env,
  stdio: 'inherit',
});

process.exit(build.status ?? 1);
