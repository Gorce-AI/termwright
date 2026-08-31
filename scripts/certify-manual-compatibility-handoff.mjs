#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createManualCompatibilityHandoff,
  createOwnedExecFile,
} from './create-manual-compatibility-handoff.mjs';

const root = await mkdtemp(join(tmpdir(), 'termwright-handoff-conformance-'));
const repository = join(root, 'repository');
const inputs = join(root, 'inputs');
const handoff = join(root, 'handoff');
const clone = join(root, 'clone');
const git = createOwnedExecFile('git');

const runGit = (args, cwd, options = {}) => git.run(args, { cwd, ...options });

try {
  await mkdir(join(repository, 'compatibility'), { recursive: true });
  await mkdir(join(inputs, 'verdicts'), { recursive: true });
  await writeFile(join(repository, 'compatibility/certified-upstreams.json'), '{"old":true}\n');
  await writeFile(join(repository, 'compatibility/candidate-assessments.json'), '{}\n');
  await writeFile(join(inputs, 'candidate-registry.json'), '{"candidates":[]}\n');
  await writeFile(join(inputs, 'publish-plan.json'), '{"issues":[]}\n');
  await writeFile(join(inputs, 'verdicts/SHA256SUMS'), 'nested verdict material\n');

  await runGit(['init', '-q'], repository);
  await runGit(['add', '.'], repository);
  await runGit(
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'base'],
    repository,
  );
  const { stdout: sourceSha } = await runGit(['rev-parse', 'HEAD'], repository);

  await writeFile(
    join(repository, 'compatibility/certified-upstreams.json'),
    Buffer.from([0, 1, 2, 255]),
  );
  await rm(join(repository, 'compatibility/candidate-assessments.json'));

  const result = await createManualCompatibilityHandoff({
    destination: handoff,
    candidateRegistry: join(inputs, 'candidate-registry.json'),
    publishPlan: join(inputs, 'publish-plan.json'),
    verdicts: join(inputs, 'verdicts'),
    sourceRunId: '123',
    sourceRunUrl: 'https://github.com/gorce-ai/termwright/actions/runs/123',
    sourceSha: sourceSha.trim(),
    repository,
  });

  assert.deepEqual(result.changed, [
    'compatibility/candidate-assessments.json',
    'compatibility/certified-upstreams.json',
  ]);
  const patch = await readFile(join(handoff, 'reconciliation.patch'));
  assert.equal(patch.includes(Buffer.from('GIT binary patch')), true);
  assert.equal(patch.includes(Buffer.from('deleted file mode')), true);
  await verifyChecksums(handoff);

  await runGit(['clone', '-q', repository, clone], root);
  await writeFile(join(clone, 'handoff.patch'), patch);
  await runGit(['apply', '--index', '--binary', 'handoff.patch'], clone);
  const { stdout: expectedTree } = await runGit(['write-tree'], repository);
  const { stdout: actualTree } = await runGit(['write-tree'], clone);
  assert.equal(actualTree, expectedTree);
  process.stdout.write('manual compatibility handoff Git conformance passed\n');
} finally {
  await git.close();
  await rm(root, { recursive: true, force: true });
}

async function verifyChecksums(directory) {
  const manifest = await readFile(join(directory, 'SHA256SUMS'), 'utf8');
  for (const line of manifest.trim().split('\n')) {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    assert.notEqual(match, null, `invalid checksum line: ${line}`);
    const actual = createHash('sha256')
      .update(await readFile(join(directory, match[2])))
      .digest('hex');
    assert.equal(actual, match[1], `checksum mismatch: ${match[2]}`);
  }
}
