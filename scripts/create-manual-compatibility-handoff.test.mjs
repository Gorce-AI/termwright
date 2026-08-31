import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { it as resourceAwareIt } from '../packages/resource-broker/src/vitest.ts';
import {
  checksumArtifactPath,
  createOwnedExecFile,
  createManualCompatibilityHandoff,
} from './create-manual-compatibility-handoff.mjs';

const hostIt = resourceAwareIt.resources({ hostPressure: 'exclusive' });

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'termwright-handoff-'));
  const active = new Set();
  const git = createOwnedExecFile('git', { signal: context.signal });
  const track = (promise) => {
    active.add(promise);
    void promise.finally(() => active.delete(promise)).catch(() => undefined);
    return promise;
  };
  const command = (commandName, args, cwd) => {
    if (commandName !== 'git') throw new Error(`unexpected fixture command ${commandName}`);
    return git.run(args, { cwd });
  };
  context.onTestFinished(async () => {
    await Promise.allSettled([...active]);
    await git.close();
    await rm(root, { recursive: true, force: true });
  });
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
  await command('git', ['add', '.'], repository);
  await command(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'base'],
    repository,
  );
  const { stdout: sourceSha } = await command('git', ['rev-parse', 'HEAD'], repository);
  return {
    root,
    repository,
    inputs,
    handoff: join(root, 'handoff'),
    sourceSha: sourceSha.trim(),
    command,
    track,
    signal: context.signal,
  };
}

async function create({ repository, inputs, handoff, sourceSha, track, signal }) {
  return track(
    createManualCompatibilityHandoff({
      destination: handoff,
      candidateRegistry: join(inputs, 'candidate-registry.json'),
      publishPlan: join(inputs, 'publish-plan.json'),
      verdicts: join(inputs, 'verdicts'),
      sourceRunId: '123',
      sourceRunUrl: 'https://github.com/gorce-ai/termwright/actions/runs/123',
      sourceSha,
      repository,
      signal,
    }),
  );
}

async function verifyChecksums(directory) {
  const manifest = await readFile(join(directory, 'SHA256SUMS'), 'utf8');
  for (const line of manifest.trim().split('\n')) {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    if (match === null) throw new Error(`invalid checksum line: ${line}`);
    const actual = createHash('sha256')
      .update(await readFile(join(directory, match[2])))
      .digest('hex');
    if (actual !== match[1]) throw new Error(`checksum mismatch: ${match[2]}`);
  }
}

describe('manual compatibility handoff', () => {
  hostIt(
    'waits for an aborted child to close before its working directory is removed',
    async (context) => {
      const root = await mkdtemp(join(tmpdir(), 'termwright-owned-child-'));
      const controller = new AbortController();
      const owner = createOwnedExecFile(process.execPath, {
        cwd: root,
        signal: controller.signal,
      });
      const abortFromTest = () => controller.abort(context.signal.reason);
      context.signal.addEventListener('abort', abortFromTest, { once: true });
      context.onTestFinished(async () => {
        context.signal.removeEventListener('abort', abortFromTest);
        controller.abort();
        await owner.close();
        await rm(root, { recursive: true, force: true });
      });

      // execFile synchronously creates the ChildProcess before run() returns;
      // aborting now exercises the process-close barrier without polling or a timer.
      const running = owner.run(['-e', 'process.stdin.resume()'], {
        input: Buffer.alloc(16 * 1024 * 1024),
      });
      controller.abort();
      await expect(running).rejects.toMatchObject({ name: 'AbortError' });
      await owner.close();
      await expect(rm(root, { recursive: true, force: true })).resolves.toBeUndefined();
    },
  );

  hostIt('owns a child stdin failure without leaking an uncaught stream error', async () => {
    const owner = createOwnedExecFile(process.execPath);
    try {
      await expect(
        owner.run(['-e', 'process.stdin.destroy(); process.exit(0)'], {
          input: Buffer.alloc(16 * 1024 * 1024),
        }),
      ).rejects.toBeInstanceOf(Error);
    } finally {
      await owner.close();
    }
  });

  hostIt(
    'packages an exact binary/deletion patch with verifiable tamper-evident checksums',
    async (testContext) => {
      const context = await changedFixture(testContext);
      const result = await create(context);
      expect(result.changed).toHaveLength(2);
      expect(await readFile(join(context.handoff, 'changed-files.txt'), 'utf8')).toBe(
        'compatibility/candidate-assessments.json\ncompatibility/certified-upstreams.json\n',
      );
      const patch = await readFile(join(context.handoff, 'reconciliation.patch'));
      expect(patch.includes(Buffer.from('GIT binary patch'))).toBe(true);
      expect(patch.includes(Buffer.from('deleted file mode'))).toBe(true);
      await verifyChecksums(context.handoff);
      expect(await readFile(join(context.handoff, 'SHA256SUMS'), 'utf8')).toContain(
        'verdicts/SHA256SUMS',
      );
      await writeFile(join(context.handoff, 'publish-plan.json'), '{"tampered":true}\n');
      await expect(verifyChecksums(context.handoff)).rejects.toThrow(/checksum mismatch/u);
    },
  );

  hostIt('recreates the exact staged tree from its binary/deletion patch', async (testContext) => {
    const context = await changedFixture(testContext);
    await create(context);
    const patch = await readFile(join(context.handoff, 'reconciliation.patch'));
    const clone = join(context.root, 'clone');
    await context.command('git', ['clone', '-q', context.repository, clone], context.root);
    await writeFile(join(clone, 'handoff.patch'), patch);
    await context.command('git', ['apply', '--index', '--binary', 'handoff.patch'], clone);
    const { stdout: expectedTree } = await context.command(
      'git',
      ['write-tree'],
      context.repository,
    );
    const { stdout: actualTree } = await context.command('git', ['write-tree'], clone);
    expect(actualTree).toBe(expectedTree);
  });

  hostIt(
    'emits a truly empty change list and patch when reconciliation is unchanged',
    async (testContext) => {
      const context = await fixture(testContext);
      const result = await create(context);
      expect(result.changed).toHaveLength(0);
      expect(await readFile(join(context.handoff, 'changed-files.txt'), 'utf8')).toBe('');
      expect((await readFile(join(context.handoff, 'reconciliation.patch'))).length).toBe(0);
      await verifyChecksums(context.handoff);
    },
  );

  hostIt('binds the artifact to the exact repository HEAD', async (testContext) => {
    const context = await fixture(testContext);
    await expect(create({ ...context, sourceSha: 'a'.repeat(40) })).rejects.toThrow(
      /does not match repository HEAD/u,
    );
  });

  hostIt('rejects a forbidden change even when it was already staged', async (testContext) => {
    const context = await fixture(testContext);
    await writeFile(join(context.repository, 'README.md'), 'forbidden\n');
    await context.command('git', ['add', 'README.md'], context.repository);
    await expect(create(context)).rejects.toThrow(/forbidden path README\.md/u);
  });

  hostIt(
    'rejects an already-staged regular file above the per-file safety bound',
    async (testContext) => {
      const context = await fixture(testContext);
      await writeFile(
        join(context.repository, 'compatibility/certified-upstreams.json'),
        Buffer.alloc(2 * 1024 * 1024 + 1),
      );
      await context.command(
        'git',
        ['add', 'compatibility/certified-upstreams.json'],
        context.repository,
      );
      await expect(create(context)).rejects.toThrow(/2 MiB safety bound/u);
    },
  );

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

async function changedFixture(testContext) {
  const context = await fixture(testContext);
  await writeFile(join(context.inputs, 'verdicts/SHA256SUMS'), 'nested verdict material\n');
  await writeFile(
    join(context.repository, 'compatibility/certified-upstreams.json'),
    Buffer.from([0, 1, 2, 255]),
  );
  await rm(join(context.repository, 'compatibility/candidate-assessments.json'));
  return context;
}
