import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const available = spawnSync('cargo', ['--version'], {stdio: 'ignore'});
if (available.status !== 0) {
  console.log('ratatui-list: no Rust toolchain, skipping the build');
  process.exit(0);
}

const tool = fileURLToPath(new URL('../build-tool/Cargo.toml', import.meta.url));
const app = fileURLToPath(new URL('../app', import.meta.url));
const build = spawnSync('cargo', ['run', '--quiet', '--manifest-path', tool, '--', app], {
  stdio: 'inherit',
});
process.exit(build.status ?? 1);
