import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  INK_INSTRUMENTATION_SENTINEL,
  INK_VERSION,
  instrumentInkCore,
  instrumentInkRenderer,
  instrumentationSentinel,
} from './instrumentation.js';
import certified from './certified-instrumentation.json' with { type: 'json' };

const inkBuild = dirname(createRequire(import.meta.url).resolve('ink'));

describe('certified Ink instrumentation', () => {
  it('instruments the exact 7.1.1 renderer and core artifacts', async () => {
    const rendererPath = join(inkBuild, 'renderer.js');
    const corePath = join(inkBuild, 'ink.js');
    const renderer = instrumentInkRenderer(rendererPath, await readFile(rendererPath, 'utf8'));
    const core = instrumentInkCore(corePath, await readFile(corePath, 'utf8'));
    expect(renderer).toContain('termwright.ink.render-capture.v1');
    expect(renderer).toContain(`frameworkVersion: "${INK_VERSION}"`);
    expect(core).toContain('termwright.ink.frame-context.v1');
    expect(core).toContain('coreChecksum');
  });

  it('fails closed when either audited artifact changes', async () => {
    const rendererPath = join(inkBuild, 'renderer.js');
    const corePath = join(inkBuild, 'ink.js');
    expect(
      instrumentInkRenderer(rendererPath, `${await readFile(rendererPath, 'utf8')}\n// changed`),
    ).toBeUndefined();
    expect(
      instrumentInkCore(corePath, `${await readFile(corePath, 'utf8')}\n// changed`),
    ).toBeUndefined();
  });

  it('requires one matching renderer and core profile before enabling capture', () => {
    const profile = certified.profiles.find((entry) => entry.version === INK_VERSION);
    expect(profile).toBeDefined();
    const globals = globalThis as Record<PropertyKey, unknown>;
    const prior = globals[INK_INSTRUMENTATION_SENTINEL];
    try {
      globals[INK_INSTRUMENTATION_SENTINEL] = Object.freeze({
        version: 1,
        frameworkVersion: profile!.version,
        rendererChecksum: profile!.rendererSha256,
      });
      expect(instrumentationSentinel()).toBeUndefined();

      globals[INK_INSTRUMENTATION_SENTINEL] = Object.freeze({
        version: 1,
        frameworkVersion: profile!.version,
        coreChecksum: profile!.coreSha256,
      });
      expect(instrumentationSentinel()).toBeUndefined();

      globals[INK_INSTRUMENTATION_SENTINEL] = Object.freeze({
        version: 1,
        frameworkVersion: profile!.version,
        rendererChecksum: profile!.rendererSha256,
        coreChecksum: profile!.coreSha256,
      });
      expect(instrumentationSentinel()).toEqual(
        expect.objectContaining({
          frameworkVersion: INK_VERSION,
        }),
      );
    } finally {
      if (prior === undefined) delete globals[INK_INSTRUMENTATION_SENTINEL];
      else globals[INK_INSTRUMENTATION_SENTINEL] = prior;
    }
  });

  it('does not patch matching-looking files outside Ink', () => {
    expect(instrumentInkRenderer('/tmp/renderer.js', '')).toBeUndefined();
    expect(instrumentInkCore('/tmp/ink.js', '')).toBeUndefined();
  });

  it('accepts a source-bound candidate profile and rejects a stale binding', async () => {
    const rendererPath = join(inkBuild, 'renderer.js');
    const corePath = join(inkBuild, 'ink.js');
    const renderer = await readFile(rendererPath, 'utf8');
    const core = await readFile(corePath, 'utf8');
    const old = { ...process.env };
    Object.assign(process.env, {
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: 'candidate-sha',
      TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST: `sha256:${'c'.repeat(64)}`,
      TERMWRIGHT_CERTIFICATION_SOURCE_REVISION: 'candidate-sha',
      TERMWRIGHT_CERTIFICATION_HOOK_PROFILE: JSON.stringify({
        framework: 'ink',
        version: '7.1.1-candidate',
        sourceRevision: 'candidate-sha',
        candidateDigest: `sha256:${'c'.repeat(64)}`,
        rendererSha256: createHash('sha256').update(renderer).digest('hex'),
        coreSha256: createHash('sha256').update(core).digest('hex'),
      }),
    });
    try {
      expect(instrumentInkRenderer(rendererPath, renderer)).toContain(
        'frameworkVersion: "7.1.1-candidate"',
      );
      process.env['GITHUB_SHA'] = 'stale-sha';
      // The built-in exact profile still accepts the real artifact, but the
      // untrusted candidate version can never appear in its output.
      expect(instrumentInkRenderer(rendererPath, renderer)).not.toContain('7.1.1-candidate');
    } finally {
      process.env = old;
    }
  });
});
