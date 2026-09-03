import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect } from 'vitest';
import { it as resourceAwareIt } from '../packages/test-provider-internal/src/index.ts';
import { pnpmInvocation } from './package-manager-command.mjs';

const exec = promisify(execFile);
const it = resourceAwareIt.resources({ hostPressure: 'exclusive' });
// `URL.pathname` yields "/D:/a/repo" on Windows, which is not a usable path.
const root = fileURLToPath(new URL('..', import.meta.url));
const pnpm = pnpmInvocation([], { env: process.env });
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

    await exec(
      pnpm.command,
      [...pnpm.args, '--dir', 'packages/protocol', 'pack', '--pack-destination', archiveDirectory],
      { cwd: root },
    );
    const archive = (await readdir(archiveDirectory)).find((name) => name.endsWith('.tgz'));
    expect(archive).toBeDefined();
    // The tar on Windows runners is GNU tar, which reads a colon in a path
    // argument as a remote `host:path` transfer and escapes what follows. An
    // absolute Windows path therefore fails in both the archive argument
    // ("Cannot connect to C:") and the -C argument ("C\:\\Users..."). Running
    // from the scratch directory keeps every path it sees relative.
    await exec(
      'tar',
      // Forward slashes: tar reads a backslash as an escape, not a separator.
      [
        '-xzf',
        `archives/${archive}`,
        '--strip-components=1',
        '-C',
        'node_modules/@termwright/protocol',
      ],
      { cwd: directory },
    );

    const consumer = join(directory, 'consumer.mjs');
    await writeFile(
      consumer,
      [
        "import { SESSION_CAPABILITIES } from '@termwright/protocol/contract';",
        "import { CONDITION_KINDS } from '@termwright/protocol/action-model';",
        "if (!SESSION_CAPABILITIES.includes('pointer-input')) throw new Error('contract export missing');",
        "if (!CONDITION_KINDS.includes('visible')) throw new Error('action-model export missing');",
      ].join('\n'),
      'utf8',
    );

    await expect(exec(process.execPath, [consumer], { cwd: directory })).resolves.toMatchObject({
      stderr: '',
    });
  }, 30_000);
});

describe('private test-engine subpaths', () => {
  it('stay unreachable from a packed clean consumer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-private-runner-'));
    scratch.push(directory);
    const archiveDirectory = join(directory, 'archives');
    await mkdir(archiveDirectory, { recursive: true });
    for (const packageName of ['test', 'resource-broker']) {
      const packageDirectory = join(directory, 'node_modules', '@termwright', packageName);
      await mkdir(packageDirectory, { recursive: true });
      const before = new Set(await readdir(archiveDirectory));
      await exec(
        pnpm.command,
        [
          ...pnpm.args,
          '--dir',
          `packages/${packageName}`,
          'pack',
          '--pack-destination',
          archiveDirectory,
        ],
        { cwd: root },
      );
      const archives = (await readdir(archiveDirectory)).filter((name) => !before.has(name));
      expect(archives).toHaveLength(1);
      await exec(
        'tar',
        [
          '-xzf',
          `archives/${archives[0]}`,
          '--strip-components=1',
          '-C',
          `node_modules/@termwright/${packageName}`,
        ],
        { cwd: directory },
      );
    }

    const consumer = join(directory, 'consumer.mjs');
    await writeFile(
      consumer,
      [
        "for (const specifier of ['@termwright/test/runner', '@termwright/test/vitest-engine', '@termwright/resource-broker/vitest']) {",
        '  try {',
        '    await import(specifier);',
        '    throw new Error(`private engine subpath resolved: ${specifier}`);',
        '  } catch (error) {',
        "    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;",
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    await expect(exec(process.execPath, [consumer], { cwd: directory })).resolves.toMatchObject({
      stderr: '',
    });
  }, 30_000);
});
