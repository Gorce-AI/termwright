import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { certifyOpenTuiEntry } from './certification.js';

const temporary: string[] = [];
const UNSUPPORTED_VERSION = '0.0.0-termwright-unsupported';

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('OpenTUI runtime certification', () => {
  it('certifies the exact installed package version without inspecting chunks', () => {
    const entry = createRequire(import.meta.url).resolve('@opentui/core');
    const installed = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as {
      version: string;
    };
    const certification = certifyOpenTuiEntry(entry);

    expect(certification?.version).toBe(installed.version);
    expect(certification?.source).toBe(
      process.env['TERMWRIGHT_CERTIFICATION_HOOK_PROFILE'] === undefined ? 'builtin' : 'candidate',
    );
  });

  it('refuses an unsupported package version', async () => {
    const entry = await fakePackage(UNSUPPORTED_VERSION);

    expect(certifyOpenTuiEntry(entry, {})).toBeUndefined();
  });

  it('accepts a CI candidate only when version, digest, and revision all bind', async () => {
    const entry = await fakePackage('0.5.8');
    const digest = `sha256:${'c'.repeat(64)}`;
    const revision = 'd'.repeat(40);
    const profile = JSON.stringify({
      framework: 'opentui',
      version: '0.5.8',
      candidateDigest: digest,
      sourceRevision: revision,
    });
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: revision,
      TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST: digest,
      TERMWRIGHT_CERTIFICATION_SOURCE_REVISION: revision,
      TERMWRIGHT_CERTIFICATION_HOOK_PROFILE: profile,
    };

    expect(certifyOpenTuiEntry(entry, env)).toEqual({
      version: '0.5.8',
      source: 'candidate',
      candidateDigest: digest,
      sourceRevision: revision,
    });
    expect(certifyOpenTuiEntry(entry, { ...env, GITHUB_SHA: 'e'.repeat(40) })).toBeUndefined();
    expect(
      certifyOpenTuiEntry(entry, {
        ...env,
        TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST: `sha256:${'f'.repeat(64)}`,
      }),
    ).toBeUndefined();
  });

  it('gives an explicitly bound candidate precedence over a builtin version', async () => {
    const entry = await fakePackage('0.5.3');
    const digest = `sha256:${'a'.repeat(64)}`;
    const revision = 'b'.repeat(40);
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: revision,
      TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST: digest,
      TERMWRIGHT_CERTIFICATION_SOURCE_REVISION: revision,
      TERMWRIGHT_CERTIFICATION_HOOK_PROFILE: JSON.stringify({
        framework: 'opentui',
        version: '0.5.3',
        candidateDigest: digest,
        sourceRevision: revision,
      }),
    };

    expect(certifyOpenTuiEntry(entry, env)).toEqual({
      version: '0.5.3',
      source: 'candidate',
      candidateDigest: digest,
      sourceRevision: revision,
    });
    expect(
      certifyOpenTuiEntry(entry, {
        ...env,
        TERMWRIGHT_CERTIFICATION_SOURCE_REVISION: 'c'.repeat(40),
      }),
    ).toBeUndefined();
    expect(
      certifyOpenTuiEntry(entry, {
        TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST: digest,
      }),
    ).toBeUndefined();
  });

  it('does not let another framework candidate disable a builtin OpenTUI profile', async () => {
    const entry = await fakePackage('0.5.3');
    const revision = 'b'.repeat(40);
    const digest = `sha256:${'a'.repeat(64)}`;

    expect(
      certifyOpenTuiEntry(entry, {
        GITHUB_ACTIONS: 'true',
        GITHUB_SHA: revision,
        TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST: digest,
        TERMWRIGHT_CERTIFICATION_SOURCE_REVISION: revision,
        TERMWRIGHT_CERTIFICATION_HOOK_PROFILE: JSON.stringify({
          framework: 'ink',
          version: '7.1.1',
          candidateDigest: digest,
          sourceRevision: revision,
        }),
      }),
    ).toEqual({ version: '0.5.3', source: 'builtin' });
  });
});

async function fakePackage(version: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tw-opentui-runtime-cert-'));
  temporary.push(root);
  const directory = join(root, '@opentui', 'core');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: '@opentui/core', version }),
  );
  const entry = join(directory, 'index.bun.js');
  await writeFile(entry, 'export {};');
  return entry;
}
