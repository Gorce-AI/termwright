import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { instrumentOpenTuiChunk } from './instrumentation.js';

const coreDirectory = dirname(createRequire(import.meta.url).resolve('@opentui/core'));

async function instrumentableBuilds(directory: string, version: string) {
  const accepted: Array<{ runtime: 'node' | 'bun'; file: string; path: string; source: string; output: string }> = [];
  for (const file of (await readdir(directory)).filter((entry) => /^chunk-(?:node|bun)-[A-Za-z0-9_-]+\.js$/u.test(entry)).sort()) {
    const path = join(directory, file);
    const source = await readFile(path, 'utf8');
    const output = instrumentOpenTuiChunk(path, source);
    if (output?.includes(`frameworkVersion: "${version}"`) === true) {
      accepted.push({ runtime: /^chunk-(node|bun)-/u.exec(file)![1]! as 'node' | 'bun', file, path, source, output });
    }
  }
  accepted.sort((left, right) => ['node', 'bun'].indexOf(left.runtime) - ['node', 'bun'].indexOf(right.runtime));
  if (accepted.length !== 2 || accepted[0]?.runtime !== 'node' || accepted[1]?.runtime !== 'bun') {
    throw new Error(`expected exactly one instrumentable Node and Bun build for OpenTUI ${version}; found ${accepted.map((entry) => entry.file).join(', ')}`);
  }
  return accepted;
}

describe('certified OpenTUI instrumentation', () => {
  it('instruments exactly the installed Node and Bun artifacts', async () => {
    const installed = JSON.parse(await readFile(join(coreDirectory, 'package.json'), 'utf8')) as { version: string };
    const builds = await instrumentableBuilds(coreDirectory, installed.version);
    expect(builds.map((entry) => entry.runtime)).toEqual(['node', 'bun']);
    for (const { output } of builds) {
      expect(output).toContain(`frameworkVersion: "${installed.version}"`);
      expect(output).toContain('__termwrightGeometryBegin(this._ctx, this)');
      expect(output).toContain('__termwrightGeometryRecord(this._ctx, command.renderable)');
      expect(output).toContain('__termwrightGeometryPush(this._ctx, command.x');
      expect(output).toContain('__termwrightGeometryComplete(this._ctx, this)');
      expect(output).toContain('__termwrightGeometryCommit(this)');
    }
  });

  it('fails closed when even one upstream byte changes', async () => {
    const installed = JSON.parse(await readFile(join(coreDirectory, 'package.json'), 'utf8')) as { version: string };
    const [node] = await instrumentableBuilds(coreDirectory, installed.version);
    expect(node).toBeDefined();
    expect(instrumentOpenTuiChunk(node!.path, `${node!.source}\n// changed`)).toBeUndefined();
  });

  it('does not treat an unrelated chunk with a matching-looking body as OpenTUI', () => {
    expect(instrumentOpenTuiChunk('/tmp/chunk-node-kq7as74d.js', '')).toBeUndefined();
  });

  it('accepts only a revision-bound exact candidate build pair', async () => {
    const manifest = JSON.parse(await readFile(join(coreDirectory, 'package.json'), 'utf8')) as { version: string };
    const installed = await instrumentableBuilds(coreDirectory, manifest.version);
    const files = installed.map((entry) => entry.file);
    const sources = installed.map((entry) => entry.source);
    const old = { ...process.env };
    Object.assign(process.env, {
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: 'candidate-sha',
      TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST: `sha256:${'c'.repeat(64)}`,
      TERMWRIGHT_CERTIFICATION_SOURCE_REVISION: 'candidate-sha',
      TERMWRIGHT_CERTIFICATION_HOOK_PROFILE: JSON.stringify({
        framework: 'opentui',
        version: '0.5.3-candidate',
        sourceRevision: 'candidate-sha',
        candidateDigest: `sha256:${'c'.repeat(64)}`,
        builds: files.map((file, index) => ({ id: file.slice(6, -3), file, sha256: createHash('sha256').update(sources[index]!).digest('hex') })),
      }),
    });
    try {
      expect(instrumentOpenTuiChunk(join(coreDirectory, files[0]!), sources[0]!)).toContain('frameworkVersion: "0.5.3-candidate"');
      process.env['TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST'] = `sha256:${'d'.repeat(64)}`;
      const mismatched = instrumentOpenTuiChunk(join(coreDirectory, files[0]!), sources[0]!);
      expect(mismatched?.includes('frameworkVersion: "0.5.3-candidate"')).not.toBe(true);
    } finally {
      process.env = old;
    }
  });

  it('selects a synthetic candidate pair without assuming its hashed filenames', async () => {
    const manifest = JSON.parse(await readFile(join(coreDirectory, 'package.json'), 'utf8')) as { version: string };
    const installed = await instrumentableBuilds(coreDirectory, manifest.version);
    const scratch = await mkdtemp(join(tmpdir(), 'tw-opentui-candidate-'));
    const directory = join(scratch, '@opentui/core');
    await mkdir(directory, { recursive: true });
    const candidateFiles = ['chunk-node-newcandidate.js', 'chunk-bun-newcandidate.js'];
    for (const [index, file] of candidateFiles.entries()) await writeFile(join(directory, file), installed[index]!.source);
    for (const entry of installed) await writeFile(join(directory, entry.file), entry.source);
    const old = { ...process.env };
    Object.assign(process.env, {
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: 'candidate-sha',
      TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST: `sha256:${'c'.repeat(64)}`,
      TERMWRIGHT_CERTIFICATION_SOURCE_REVISION: 'candidate-sha',
      TERMWRIGHT_CERTIFICATION_HOOK_PROFILE: JSON.stringify({
        framework: 'opentui',
        version: '0.5.4-candidate',
        sourceRevision: 'candidate-sha',
        candidateDigest: `sha256:${'c'.repeat(64)}`,
        builds: candidateFiles.map((file, index) => ({ id: file.slice(6, -3), file, sha256: createHash('sha256').update(installed[index]!.source).digest('hex') })),
      }),
    });
    try {
      const selected = await instrumentableBuilds(directory, '0.5.4-candidate');
      expect(selected.map((entry) => entry.file)).toEqual(candidateFiles);
      expect(instrumentOpenTuiChunk(selected[0]!.path, `${selected[0]!.source}\n// changed`)).toBeUndefined();
      process.env['TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST'] = `sha256:${'d'.repeat(64)}`;
      expect(instrumentOpenTuiChunk(selected[0]!.path, selected[0]!.source)).toBeUndefined();
    } finally {
      process.env = old;
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
