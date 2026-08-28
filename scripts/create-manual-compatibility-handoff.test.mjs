import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { checksumArtifactPath } from './create-manual-compatibility-handoff.mjs';

const execFile = promisify(execFileCallback);
const script = fileURLToPath(new URL('./create-manual-compatibility-handoff.mjs', import.meta.url));

async function command(commandName, args, cwd) {
  return execFile(commandName, args, { cwd, maxBuffer: 32 * 1024 * 1024 });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'termwright-handoff-'));
  const repository = join(root, 'repository');
  const inputs = join(root, 'inputs');
  await mkdir(join(repository, 'compatibility'), { recursive: true });
  await mkdir(inputs);
  await writeFile(join(repository, 'compatibility/certified-upstreams.json'), '{"old":true}\n');
  await writeFile(join(repository, 'compatibility/candidate-assessments.json'), '{}\n');
  await writeFile(join(inputs, 'candidate-registry.json'), '{"candidates":[]}\n');
  await writeFile(join(inputs, 'publish-plan.json'), '{"issues":[]}\n');
  await mkdir(join(inputs, 'verdicts'));
  await command('git', ['init', '-q'], repository);
  await command('git', ['config', 'user.email', 'test@example.com'], repository);
  await command('git', ['config', 'user.name', 'Test'], repository);
  await command('git', ['add', '.'], repository);
  await command('git', ['commit', '-qm', 'base'], repository);
  const { stdout: sourceSha } = await command('git', ['rev-parse', 'HEAD'], repository);
  return { root, repository, inputs, handoff: join(root, 'handoff'), sourceSha: sourceSha.trim() };
}

async function create({ repository, inputs, handoff, sourceSha }) {
  return command(
    process.execPath,
    [
      script,
      handoff,
      join(inputs, 'candidate-registry.json'),
      join(inputs, 'publish-plan.json'),
      join(inputs, 'verdicts'),
      '123',
      'https://github.com/gorce-ai/termwright/actions/runs/123',
      sourceSha,
    ],
    repository,
  );
}

describe('manual compatibility handoff', () => {
  it('packages an exact binary/deletion patch with verifiable tamper-evident checksums', async () => {
    const context = await fixture();
    await writeFile(join(context.inputs, 'verdicts/SHA256SUMS'), 'nested verdict material\n');
    await writeFile(
      join(context.repository, 'compatibility/certified-upstreams.json'),
      Buffer.from([0, 1, 2, 255]),
    );
    await rm(join(context.repository, 'compatibility/candidate-assessments.json'));
    const result = await create(context);
    expect(result.stdout.trim()).toBe('2');
    expect(await readFile(join(context.handoff, 'changed-files.txt'), 'utf8')).toBe(
      'compatibility/candidate-assessments.json\ncompatibility/certified-upstreams.json\n',
    );
    const patch = await readFile(join(context.handoff, 'reconciliation.patch'));
    expect(patch.includes(Buffer.from('GIT binary patch'))).toBe(true);
    expect(patch.includes(Buffer.from('deleted file mode'))).toBe(true);
    await command('sha256sum', ['--check', 'SHA256SUMS'], context.handoff);
    expect(await readFile(join(context.handoff, 'SHA256SUMS'), 'utf8')).toContain(
      'verdicts/SHA256SUMS',
    );
    await writeFile(join(context.handoff, 'publish-plan.json'), '{"tampered":true}\n');
    await expect(
      command('sha256sum', ['--check', 'SHA256SUMS'], context.handoff),
    ).rejects.toThrow();

    const clone = join(context.root, 'clone');
    await command('git', ['clone', '-q', context.repository, clone], context.root);
    await writeFile(join(clone, 'handoff.patch'), patch);
    await command('git', ['apply', '--index', '--binary', 'handoff.patch'], clone);
    const { stdout: expectedTree } = await command('git', ['write-tree'], context.repository);
    const { stdout: actualTree } = await command('git', ['write-tree'], clone);
    expect(actualTree).toBe(expectedTree);
  });

  it('emits a truly empty change list and patch when reconciliation is unchanged', async () => {
    const context = await fixture();
    const result = await create(context);
    expect(result.stdout.trim()).toBe('0');
    expect(await readFile(join(context.handoff, 'changed-files.txt'), 'utf8')).toBe('');
    expect((await readFile(join(context.handoff, 'reconciliation.patch'))).length).toBe(0);
    await command('sha256sum', ['--check', 'SHA256SUMS'], context.handoff);
  });

  it('binds the artifact to the exact repository HEAD', async () => {
    const context = await fixture();
    await expect(create({ ...context, sourceSha: 'a'.repeat(40) })).rejects.toThrow(
      /does not match repository HEAD/u,
    );
  });

  it('rejects a forbidden change even when it was already staged', async () => {
    const context = await fixture();
    await writeFile(join(context.repository, 'README.md'), 'forbidden\n');
    await command('git', ['add', 'README.md'], context.repository);
    await expect(create(context)).rejects.toThrow(/forbidden path README\.md/u);
  });

  it('rejects an already-staged regular file above the per-file safety bound', async () => {
    const context = await fixture();
    await writeFile(
      join(context.repository, 'compatibility/certified-upstreams.json'),
      Buffer.alloc(2 * 1024 * 1024 + 1),
    );
    await command('git', ['add', 'compatibility/certified-upstreams.json'], context.repository);
    await expect(create(context)).rejects.toThrow(/2 MiB safety bound/u);
  });

  it('normalizes Windows separators while rejecting unsafe literal artifact names', () => {
    expect(checksumArtifactPath('verdicts\\result.json', '\\')).toBe('verdicts/result.json');
    expect(() => checksumArtifactPath('verdicts/bad\nname.json', '/')).toThrow(
      /cannot be represented safely/u,
    );
    expect(() => checksumArtifactPath('verdicts/bad\\name.json', '/')).toThrow(
      /cannot be represented safely/u,
    );
  });
});
