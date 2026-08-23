import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
// `URL.pathname` yields "/D:/a/repo" on Windows, which is not a usable path.
const root = fileURLToPath(new URL('..', import.meta.url));
// Node refuses to spawn a .cmd without a shell on Windows (the mitigation for
// CVE-2024-27980), and without one it cannot find pnpm at all because
// execFile does not consult PATHEXT. Both arguments below are literals owned
// by this test, so enabling the shell here introduces no injection surface.
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const PNPM_OPTIONS = process.platform === 'win32' ? { shell: true } : {};
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

    await exec(PNPM, ['--dir', 'packages/protocol', 'pack', '--pack-destination', archiveDirectory], { cwd: root, ...PNPM_OPTIONS });
    const archive = (await readdir(archiveDirectory)).find((name) => name.endsWith('.tgz'));
    expect(archive).toBeDefined();
    // GNU tar reads `host:path` in the archive argument as a remote transfer,
    // so an absolute Windows path makes it try to resolve the drive letter as a
    // hostname. Naming the archive relative to its own directory keeps the
    // colon out of that argument; -C is not parsed that way.
    await exec('tar', ['-xzf', archive, '--strip-components=1', '-C', packageDirectory], { cwd: archiveDirectory });

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
