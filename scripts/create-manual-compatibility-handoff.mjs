#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  validateChangedFileObjects,
  validateChangedFiles,
} from './autonomous-release-coordinator.mjs';
import { isDirectExecution } from './is-direct-execution.mjs';

const execFile = promisify(execFileCallback);
const SHA = /^[0-9a-f]{40}$/u;

async function git(args, options = {}) {
  return execFile('git', args, { maxBuffer: 32 * 1024 * 1024, ...options });
}

async function regularIndexEntry(path) {
  try {
    await git(['cat-file', '-e', `:${path}`]);
  } catch (error) {
    if (error?.code === 128) return null;
    throw error;
  }
  const [{ stdout: stage }, { stdout: sizeText }] = await Promise.all([
    git(['ls-files', '--stage', '-z', '--', path], { encoding: 'buffer' }),
    git(['cat-file', '-s', `:${path}`]),
  ]);
  const terminator = stage.indexOf(0);
  if (terminator < 0) throw new Error(`changed path has an invalid index entry: ${path}`);
  const record = stage.subarray(0, terminator).toString('utf8');
  const separator = record.indexOf('\t');
  const [mode, , stageNumber] = record.slice(0, separator).split(' ');
  if (separator < 0 || stageNumber !== '0')
    throw new Error(`changed path has an invalid index entry: ${path}`);
  return { path, mode, type: 'blob', size: Number(sizeText.trim()) };
}

async function filesBelow(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await filesBelow(path)));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`handoff contains a non-regular object: ${path}`);
  }
  return result;
}

export async function createManualCompatibilityHandoff({
  destination,
  candidateRegistry,
  publishPlan,
  verdicts,
  sourceRunId,
  sourceRunUrl,
  sourceSha,
}) {
  if (!SHA.test(sourceSha)) throw new Error('source SHA must be an exact 40-character SHA');
  if (!/^[1-9][0-9]*$/u.test(sourceRunId)) throw new Error('source run id must be numeric');
  if (!/^https:\/\/github\.com\//u.test(sourceRunUrl))
    throw new Error('source run URL must be an HTTPS GitHub URL');

  const { stdout: head } = await git(['rev-parse', 'HEAD']);
  if (head.trim() !== sourceSha) throw new Error('source SHA does not match repository HEAD');
  const [{ stdout: tracked }, { stdout: untracked }] = await Promise.all([
    git(['diff', '--name-only', '-z', 'HEAD'], { encoding: 'buffer' }),
    git(['ls-files', '-z', '--others', '--exclude-standard'], { encoding: 'buffer' }),
  ]);
  const changed = [
    ...new Set(Buffer.concat([tracked, untracked]).toString('utf8').split('\0').filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
  if (changed.length > 0) {
    validateChangedFiles('compatibility', changed);
    await git(['add', '-A', '--', ...changed]);
    const { stdout: staged } = await git(['diff', '--cached', '--name-only', '-z', 'HEAD'], {
      encoding: 'buffer',
    });
    const stagedPaths = [...new Set(staged.toString('utf8').split('\0').filter(Boolean))].sort(
      (left, right) => left.localeCompare(right),
    );
    if (JSON.stringify(stagedPaths) !== JSON.stringify(changed))
      throw new Error('staged patch paths differ from the validated change inventory');
    const entries = (await Promise.all(changed.map(regularIndexEntry))).filter(Boolean);
    const entryPaths = new Set(entries.map((entry) => entry.path));
    validateChangedFileObjects(
      changed.map((filename) => ({
        filename,
        status: entryPaths.has(filename) ? 'modified' : 'removed',
      })),
      { tree: entries },
    );
  }

  const handoff = resolve(destination);
  await mkdir(join(handoff, 'verdicts'), { recursive: true });
  await writeFile(
    join(handoff, 'changed-files.txt'),
    changed.length === 0 ? '' : `${changed.join('\n')}\n`,
  );
  const { stdout: patch } = await git(['diff', '--cached', '--binary', '--full-index', 'HEAD'], {
    encoding: 'buffer',
  });
  await writeFile(join(handoff, 'reconciliation.patch'), patch);
  await cp(resolve(candidateRegistry), join(handoff, 'candidate-registry.json'));
  await cp(resolve(publishPlan), join(handoff, 'publish-plan.json'));
  await cp(resolve(verdicts), join(handoff, 'verdicts'), { recursive: true });
  await writeFile(
    join(handoff, 'source-run.json'),
    `${JSON.stringify({ sourceRunId, sourceRunUrl, sourceSha }, null, 2)}\n`,
  );

  const material = (await filesBelow(handoff))
    .filter((path) => path !== join(handoff, 'SHA256SUMS'))
    .sort((left, right) => left.localeCompare(right));
  const sums = [];
  for (const path of material) {
    const artifactPath = relative(handoff, path).split(sep).join('/');
    if (/[\r\n\\]/u.test(artifactPath))
      throw new Error(`handoff path cannot be represented safely in SHA256SUMS: ${artifactPath}`);
    const digest = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    sums.push(`${digest}  ${artifactPath}`);
  }
  await writeFile(join(handoff, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  return { changed };
}

if (isDirectExecution(import.meta.url)) {
  const [
    destination,
    candidateRegistry,
    publishPlan,
    verdicts,
    sourceRunId,
    sourceRunUrl,
    sourceSha,
  ] = process.argv.slice(2);
  if (
    [
      destination,
      candidateRegistry,
      publishPlan,
      verdicts,
      sourceRunId,
      sourceRunUrl,
      sourceSha,
    ].some((value) => value === undefined)
  ) {
    throw new Error(
      'usage: create-manual-compatibility-handoff <destination> <registry> <plan> <verdicts> <run-id> <run-url> <source-sha>',
    );
  }
  const { changed } = await createManualCompatibilityHandoff({
    destination,
    candidateRegistry,
    publishPlan,
    verdicts,
    sourceRunId,
    sourceRunUrl,
    sourceSha,
  });
  process.stdout.write(`${changed.length}\n`);
}
