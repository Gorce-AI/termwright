import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const packageDirectory = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../../../website/public/images/runner/', import.meta.url));
const expected = [
  'spec-catalog.png',
  'active-run.png',
  'replay-player.png',
  'failure-inspection.png',
  'semantics-inspector.png',
  'run-history.png',
  'recorder.png',
  'recorder-active.png',
  'recorder-review.png',
  'settings.png',
  'html-report.png',
];

await run('pnpm', ['run', 'build:app']);
await run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.browser.config.ts', 'src/app/docs-screenshots.e2e.ts'], {
  TERMWRIGHT_CAPTURE_DOCS: '1',
});

const actual = new Set(await readdir(outputDirectory));
for (const filename of expected) {
  if (!actual.has(filename)) throw new Error(`Missing generated Runner screenshot: ${filename}`);
  const bytes = await readFile(join(outputDirectory, filename));
  if (bytes.length < 10_000) throw new Error(`${filename} is unexpectedly small (${bytes.length} bytes)`);
  if (bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${filename} is not a PNG`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== 1440 || height !== 900) {
    throw new Error(`${filename} is ${width}x${height}; expected 1440x900`);
  }
}

process.stdout.write(`Generated ${expected.length} Runner screenshots in ${outputDirectory}\n`);

function run(command, args, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageDirectory,
      env: { ...process.env, ...extraEnvironment },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`));
    });
  });
}
