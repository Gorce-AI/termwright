#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
    const { input, ...execOptions } = options;
    let child;
    const completed = new Promise((resolveCompleted) => {
      child = execFileCallback(
        command,
        args,
        {
          maxBuffer,
          cwd,
          ...execOptions,
          ...(signal === undefined ? {} : { signal }),
        },
        (error, stdout, stderr) => {
          resolveCompleted({ error, stdout, stderr });
        },
      );
    });
    const inputCompleted = input === undefined ? Promise.resolve(null) : writeInput(child, input);
    const closed = new Promise((resolveClose) => child.once('close', resolveClose));
    activeCloses.add(closed);
    void closed.finally(() => activeCloses.delete(closed));
    return Promise.all([completed, closed, inputCompleted]).then(([result, , inputError]) => {
      if (result.error !== null) throw result.error;
      if (inputError !== null) throw inputError;
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

async function writeInput(child, input) {
  if (child.stdin === null) return new Error('owned child process has no stdin stream');
  try {
    await pipeline(Readable.from([input]), child.stdin);
    return null;
  } catch (error) {
    return error;
  }
}

function ownedGit(repository, signal) {
  return createOwnedExecFile('git', { cwd: repository, signal });
}

async function regularIndexEntries(paths, runGit) {
  const { stdout } = await runGit(['ls-files', '--stage', '-z', '--', ...paths], {
    encoding: 'buffer',
  });
  const staged = new Map();
  for (const bytes of splitNullTerminated(stdout)) {
    const separator = bytes.indexOf(0x09);
    if (separator < 0) throw new Error('changed path has an invalid index entry');
    const [mode, object, stageNumber] = bytes.subarray(0, separator).toString('utf8').split(' ');
    const path = bytes.subarray(separator + 1).toString('utf8');
    if (stageNumber !== '0' || !paths.includes(path))
      throw new Error(`changed path has an invalid index entry: ${path}`);
    staged.set(path, { mode, object });
  }
  if (staged.size === 0) return [];
  const objects = [...new Set([...staged.values()].map((entry) => entry.object))];
  const { stdout: objectInfo } = await runGit(
    ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    { input: `${objects.join('\n')}\n` },
  );
  const sizes = new Map(
    objectInfo
      .trim()
      .split('\n')
      .map((line) => {
        const [object, type, size] = line.split(' ');
        if (type !== 'blob' || !Number.isSafeInteger(Number(size)))
          throw new Error(`changed path resolves to an invalid Git object: ${object}`);
        return [object, Number(size)];
      }),
  );
  return paths.flatMap((path) => {
    const entry = staged.get(path);
    if (entry === undefined) return [];
    const size = sizes.get(entry.object);
    if (size === undefined) throw new Error(`changed path has no Git object metadata: ${path}`);
    return [{ path, mode: entry.mode, type: 'blob', size }];
  });
}

function splitNullTerminated(buffer) {
  const records = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    records.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start !== buffer.length) throw new Error('Git returned an unterminated index record');
  return records;
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
    return await createHandoffWithGit(
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

/** @internal Deterministic seam between Git effects and artifact assembly. */
export async function createHandoffWithGit(
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
    const entries = await regularIndexEntries(changed, runGit);
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
