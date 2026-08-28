#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
  validateChangedFileObjects,
  validateChangedFiles,
} from './autonomous-release-coordinator.mjs';
import { isDirectExecution } from './is-direct-execution.mjs';

const SHA = /^[0-9a-f]{40}$/u;

export function createOwnedExecFile(command, { cwd, signal, maxBuffer = 32 * 1024 * 1024 } = {}) {
  const activeCloses = new Set();
  let closing = false;
  const run = (args, options = {}) => {
    if (closing) throw new Error(`owned ${command} process group is closing`);
    let child;
    const completed = new Promise((resolveCompleted) => {
      child = execFileCallback(
        command,
        args,
        {
          maxBuffer,
          cwd,
          ...options,
          ...(signal === undefined ? {} : { signal }),
        },
        (error, stdout, stderr) => {
          resolveCompleted({ error, stdout, stderr });
        },
      );
    });
    const closed = new Promise((resolveClose) => child.once('close', resolveClose));
    activeCloses.add(closed);
    void closed.finally(() => activeCloses.delete(closed));
    return Promise.all([completed, closed]).then(([result]) => {
      if (result.error !== null) throw result.error;
      return { stdout: result.stdout, stderr: result.stderr };
    });
  };
  return {
    run,
    close: async () => {
      closing = true;
      while (activeCloses.size > 0) await Promise.allSettled([...activeCloses]);
    },
  };
}

function ownedGit(repository, signal) {
  return createOwnedExecFile('git', { cwd: repository, signal });
}

async function regularIndexEntry(path, runGit) {
  try {
    await runGit(['cat-file', '-e', `:${path}`]);
  } catch (error) {
    if (error?.code === 128) return null;
    throw error;
  }
  const [{ stdout: stage }, { stdout: sizeText }] = await Promise.all([
    runGit(['ls-files', '--stage', '-z', '--', path], { encoding: 'buffer' }),
    runGit(['cat-file', '-s', `:${path}`]),
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

export function checksumArtifactPath(relativePath, pathSeparator = sep) {
  const artifactPath = relativePath.split(pathSeparator).join('/');
  if (/[\r\n\\]/u.test(artifactPath))
    throw new Error(`handoff path cannot be represented safely in SHA256SUMS: ${artifactPath}`);
  return artifactPath;
}

export async function createManualCompatibilityHandoff({
  destination,
  candidateRegistry,
  publishPlan,
  verdicts,
  sourceRunId,
  sourceRunUrl,
  sourceSha,
  repository = process.cwd(),
  signal,
}) {
  if (!SHA.test(sourceSha)) throw new Error('source SHA must be an exact 40-character SHA');
  if (!/^[1-9][0-9]*$/u.test(sourceRunId)) throw new Error('source run id must be numeric');
  if (!/^https:\/\/github\.com\//u.test(sourceRunUrl))
    throw new Error('source run URL must be an HTTPS GitHub URL');

  const git = ownedGit(repository, signal);
  try {
    return await createHandoff(
      {
        destination,
        candidateRegistry,
        publishPlan,
        verdicts,
        sourceRunId,
        sourceRunUrl,
        sourceSha,
      },
      git.run,
    );
  } finally {
    await git.close();
  }
}

async function createHandoff(
  { destination, candidateRegistry, publishPlan, verdicts, sourceRunId, sourceRunUrl, sourceSha },
  runGit,
) {
  const { stdout: head } = await runGit(['rev-parse', 'HEAD']);
  if (head.trim() !== sourceSha) throw new Error('source SHA does not match repository HEAD');
  const [{ stdout: tracked }, { stdout: untracked }] = await Promise.all([
    runGit(['diff', '--name-only', '-z', 'HEAD'], { encoding: 'buffer' }),
    runGit(['ls-files', '-z', '--others', '--exclude-standard'], { encoding: 'buffer' }),
  ]);
  const changed = [
    ...new Set(Buffer.concat([tracked, untracked]).toString('utf8').split('\0').filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
  if (changed.length > 0) {
    validateChangedFiles('compatibility', changed);
    await runGit(['add', '-A', '--', ...changed]);
    const { stdout: staged } = await runGit(['diff', '--cached', '--name-only', '-z', 'HEAD'], {
      encoding: 'buffer',
    });
    const stagedPaths = [...new Set(staged.toString('utf8').split('\0').filter(Boolean))].sort(
      (left, right) => left.localeCompare(right),
    );
    if (JSON.stringify(stagedPaths) !== JSON.stringify(changed))
      throw new Error('staged patch paths differ from the validated change inventory');
    const entries = (
      await Promise.all(changed.map((path) => regularIndexEntry(path, runGit)))
    ).filter(Boolean);
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
  const { stdout: patch } = await runGit(['diff', '--cached', '--binary', '--full-index', 'HEAD'], {
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
    const artifactPath = checksumArtifactPath(relative(handoff, path));
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
