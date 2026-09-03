import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { it as resourceAwareIt } from '../packages/test-provider-internal/src/index.ts';
import {
  checksumArtifactPath,
  createOwnedExecFile,
  createHandoffWithGit,
} from './create-manual-compatibility-handoff.mjs';

const hostIt = resourceAwareIt.resources({ hostPressure: 'exclusive' });
const roots = [];
const SOURCE_SHA = '1'.repeat(40);
const OBJECT_SHA = '2'.repeat(40);
const CHANGED = [
  'compatibility/candidate-assessments.json',
  'compatibility/certified-upstreams.json',
];
const BINARY_DELETION_PATCH = Buffer.from(
  'diff --git a/compatibility/certified-upstreams.json b/compatibility/certified-upstreams.json\n' +
    'GIT binary patch\n' +
    'literal 4\nLc${NkWn<^!0O5@3\n\n' +
    'diff --git a/compatibility/candidate-assessments.json b/compatibility/candidate-assessments.json\n' +
    'deleted file mode 100644\n',
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'termwright-handoff-'));
  roots.push(root);
  const inputs = join(root, 'inputs');
  await mkdir(inputs);
  await writeFile(join(inputs, 'candidate-registry.json'), '{"candidates":[]}\n');
  await writeFile(join(inputs, 'publish-plan.json'), '{"issues":[]}\n');
  await mkdir(join(inputs, 'verdicts'));
  return {
    root,
    inputs,
    handoff: join(root, 'handoff'),
    sourceSha: SOURCE_SHA,
  };
}

async function create(context, runGit, sourceSha = context.sourceSha) {
  return createHandoffWithGit(
    {
      destination: context.handoff,
      candidateRegistry: join(context.inputs, 'candidate-registry.json'),
      publishPlan: join(context.inputs, 'publish-plan.json'),
      verdicts: join(context.inputs, 'verdicts'),
      sourceRunId: '123',
      sourceRunUrl: 'https://github.com/gorce-ai/termwright/actions/runs/123',
      sourceSha,
    },
    runGit,
  );
}

function scriptedGit(steps) {
  const remaining = [...steps];
  const calls = [];
  const run = async (args, options = {}) => {
    calls.push({ args, options });
    const step = remaining.shift();
    if (step === undefined) throw new Error(`unexpected Git command: ${args.join(' ')}`);
    expect(args).toEqual(step.args);
    if ('input' in step) expect(options.input).toEqual(step.input);
    return {
      stdout: step.stdout ?? (options.encoding === 'buffer' ? Buffer.alloc(0) : ''),
      stderr: '',
    };
  };
  return {
    run,
    calls,
    expectComplete: () => expect(remaining).toEqual([]),
  };
}

function changedGitScript({ objectSize = 4, patch = BINARY_DELETION_PATCH } = {}) {
  const changedBytes = Buffer.from(`${CHANGED.join('\0')}\0`);
  return scriptedGit([
    { args: ['rev-parse', 'HEAD'], stdout: `${SOURCE_SHA}\n` },
    { args: ['diff', '--name-only', '-z', 'HEAD'], stdout: changedBytes },
    { args: ['ls-files', '-z', '--others', '--exclude-standard'], stdout: Buffer.alloc(0) },
    { args: ['add', '-A', '--', ...CHANGED] },
    { args: ['diff', '--cached', '--name-only', '-z', 'HEAD'], stdout: changedBytes },
    {
      args: ['ls-files', '--stage', '-z', '--', ...CHANGED],
      stdout: Buffer.from(`100644 ${OBJECT_SHA} 0\tcompatibility/certified-upstreams.json\0`),
    },
    {
      args: ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
      input: `${OBJECT_SHA}\n`,
      stdout: `${OBJECT_SHA} blob ${objectSize}\n`,
    },
    {
      args: ['diff', '--cached', '--binary', '--full-index', 'HEAD'],
      stdout: patch,
    },
  ]);
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

  it('packages an exact binary/deletion patch with verifiable tamper-evident checksums', async () => {
    const context = await changedFixture();
    const git = changedGitScript();
    const result = await create(context, git.run);
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
    git.expectComplete();
  });

  it('emits a truly empty change list and patch when reconciliation is unchanged', async () => {
    const context = await fixture();
    const git = scriptedGit([
      { args: ['rev-parse', 'HEAD'], stdout: `${SOURCE_SHA}\n` },
      { args: ['diff', '--name-only', '-z', 'HEAD'], stdout: Buffer.alloc(0) },
      {
        args: ['ls-files', '-z', '--others', '--exclude-standard'],
        stdout: Buffer.alloc(0),
      },
      {
        args: ['diff', '--cached', '--binary', '--full-index', 'HEAD'],
        stdout: Buffer.alloc(0),
      },
    ]);
    const result = await create(context, git.run);
    expect(result.changed).toHaveLength(0);
    expect(await readFile(join(context.handoff, 'changed-files.txt'), 'utf8')).toBe('');
    expect((await readFile(join(context.handoff, 'reconciliation.patch'))).length).toBe(0);
    await verifyChecksums(context.handoff);
    git.expectComplete();
  });

  it('binds the artifact to the exact repository HEAD', async () => {
    const context = await fixture();
    const git = scriptedGit([{ args: ['rev-parse', 'HEAD'], stdout: `${SOURCE_SHA}\n` }]);
    await expect(create(context, git.run, 'a'.repeat(40))).rejects.toThrow(
      /does not match repository HEAD/u,
    );
    git.expectComplete();
  });

  it('rejects a forbidden change even when it was already staged', async () => {
    const context = await fixture();
    const git = scriptedGit([
      { args: ['rev-parse', 'HEAD'], stdout: `${SOURCE_SHA}\n` },
      { args: ['diff', '--name-only', '-z', 'HEAD'], stdout: Buffer.from('README.md\0') },
      { args: ['ls-files', '-z', '--others', '--exclude-standard'], stdout: Buffer.alloc(0) },
    ]);
    await expect(create(context, git.run)).rejects.toThrow(/forbidden path README\.md/u);
    git.expectComplete();
  });

  it('rejects an already-staged regular file above the per-file safety bound', async () => {
    const context = await fixture();
    const git = changedGitScript({ objectSize: 2 * 1024 * 1024 + 1 });
    await expect(create(context, git.run)).rejects.toThrow(/2 MiB safety bound/u);
    // Validation rejects the oversized staged object before asking Git for a patch.
    expect(git.calls.at(-1)?.args[0]).toBe('cat-file');
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

async function changedFixture() {
  const context = await fixture();
  await writeFile(join(context.inputs, 'verdicts/SHA256SUMS'), 'nested verdict material\n');
  return context;
}
