import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {prepareInstrumentedBuild} from '@termwright/probe-charm';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = fileURLToPath(new URL('../app', import.meta.url));
const available = spawnSync('go', ['version'], {stdio: 'ignore'});

if (available.status !== 0) {
  console.log('bubbletea-login: no Go toolchain, skipping the build');
  process.exit(0);
}

mkdirSync(fileURLToPath(new URL('../dist', import.meta.url)), {recursive: true});
const prepared = await prepareInstrumentedBuild({moduleDir: app});
const build = spawnSync('go', ['build', '-o', '../dist/bubbletea-login', '.'], {
  cwd: app,
  env: prepared.env,
  stdio: 'inherit',
});

process.exit(build.status ?? 1);
