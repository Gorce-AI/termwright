import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const scratch = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('published protocol subpath exports', () => {
  it('resolve from a packed package in a clean consumer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-pack-consumer-'));
    scratch.push(directory);
    const archiveDirectory = join(directory, 'archives');
    const packageDirectory = join(directory, 'node_modules', '@termwright', 'protocol');
    await mkdir(archiveDirectory, { recursive: true });
    await mkdir(packageDirectory, { recursive: true });

    await exec('pnpm', ['--dir', 'packages/protocol', 'pack', '--pack-destination', archiveDirectory], { cwd: root });
    const archive = (await readdir(archiveDirectory)).find((name) => name.endsWith('.tgz'));
    expect(archive).toBeDefined();
    await exec('tar', ['-xzf', join(archiveDirectory, archive), '--strip-components=1', '-C', packageDirectory]);

    const consumer = join(directory, 'consumer.mjs');
    await writeFile(consumer, [
      "import { SESSION_CAPABILITIES } from '@termwright/protocol/contract';",
      "import { CONDITION_KINDS } from '@termwright/protocol/action-model';",
      "if (!SESSION_CAPABILITIES.includes('pointer-input')) throw new Error('contract export missing');",
      "if (!CONDITION_KINDS.includes('visible')) throw new Error('action-model export missing');",
    ].join('\n'), 'utf8');

    await expect(exec(process.execPath, [consumer], { cwd: directory })).resolves.toMatchObject({ stderr: '' });
  }, 30_000);
});
