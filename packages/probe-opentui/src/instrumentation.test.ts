import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { instrumentOpenTuiChunk, OPENTUI_VERSION } from './instrumentation.js';

const coreDirectory = dirname(createRequire(import.meta.url).resolve('@opentui/core'));

describe('certified OpenTUI instrumentation', () => {
  it.each([
    ['node', 'chunk-node-kq7as74d.js'],
    ['bun', 'chunk-bun-t68f2fmr.js'],
  ] as const)('instruments the exact %s 0.5.3 artifact', async (_runtime, filename) => {
    const path = join(coreDirectory, filename);
    const source = await readFile(path, 'utf8');
    const output = instrumentOpenTuiChunk(path, source);

    expect(output).toBeDefined();
    expect(output).toContain(`frameworkVersion: "${OPENTUI_VERSION}"`);
    expect(output).toContain('__termwrightGeometryBegin(this._ctx, this)');
    expect(output).toContain('__termwrightGeometryRecord(this._ctx, command.renderable)');
    expect(output).toContain('__termwrightGeometryPush(this._ctx, command.x');
    expect(output).toContain('__termwrightGeometryComplete(this._ctx, this)');
    expect(output).toContain('__termwrightGeometryCommit(this)');
  });

  it('fails closed when even one upstream byte changes', async () => {
    const path = join(coreDirectory, 'chunk-node-kq7as74d.js');
    const source = await readFile(path, 'utf8');
    expect(instrumentOpenTuiChunk(path, `${source}\n// changed`)).toBeUndefined();
  });

  it('does not treat an unrelated chunk with a matching-looking body as OpenTUI', () => {
    expect(instrumentOpenTuiChunk('/tmp/chunk-node-kq7as74d.js', '')).toBeUndefined();
  });

  it('accepts only a revision-bound exact candidate build pair', async () => {
    const files = ['chunk-node-kq7as74d.js', 'chunk-bun-t68f2fmr.js'] as const;
    const sources = [
      await readFile(join(coreDirectory, files[0]), 'utf8'),
      await readFile(join(coreDirectory, files[1]), 'utf8'),
    ] as const;
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
      expect(instrumentOpenTuiChunk(join(coreDirectory, files[0]), sources[0])).toContain('frameworkVersion: "0.5.3-candidate"');
      process.env['TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST'] = `sha256:${'d'.repeat(64)}`;
      expect(instrumentOpenTuiChunk(join(coreDirectory, files[0]), sources[0])).not.toContain('0.5.3-candidate');
    } finally {
      process.env = old;
    }
  });
});
