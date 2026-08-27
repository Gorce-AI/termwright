/** Exact package-version certification for the runtime observer. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import certified from './certified-runtime.json' with { type: 'json' };

interface RuntimeProfile {
  readonly version: string;
}

export interface RuntimeCertification {
  readonly version: string;
  readonly source: 'builtin' | 'candidate';
  readonly candidateDigest?: string;
  readonly sourceRevision?: string;
}

const BUILTIN_PROFILES: readonly RuntimeProfile[] = certified.profiles;

/**
 * Certify the package root containing an intercepted OpenTUI entry.
 *
 * The observer is behavior/capability based, so certification deliberately
 * binds the package version rather than generated chunk names or bytes.
 */
export function certifyOpenTuiEntry(
  entry: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeCertification | undefined {
  const path = entryPath(entry);
  if (path === undefined) return undefined;
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(dirname(path), 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  if (manifest === null || typeof manifest !== 'object') return undefined;
  const value = manifest as Record<string, unknown>;
  if (value['name'] !== '@opentui/core' || typeof value['version'] !== 'string') return undefined;
  const version = value['version'];
  // An explicitly bound candidate run must prove that exact artifact. Falling
  // back to a builtin profile here would let a malformed candidate profile pass
  // whenever the candidate happens to have an already-supported version.
  if (hasOpenTuiCandidateBinding(env)) {
    const candidate = certificationOverride(env);
    return candidate?.version === version ? candidate : undefined;
  }
  if (BUILTIN_PROFILES.some((profile) => profile.version === version)) {
    return Object.freeze({ version, source: 'builtin' });
  }
  return undefined;
}

function hasOpenTuiCandidateBinding(env: Readonly<Record<string, string | undefined>>): boolean {
  const rawProfile = env['TERMWRIGHT_CERTIFICATION_HOOK_PROFILE'];
  if (rawProfile !== undefined) {
    try {
      const parsed = JSON.parse(rawProfile) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        const framework = (parsed as Record<string, unknown>)['framework'];
        // Candidate variables are shared by framework jobs. A complete profile
        // explicitly bound to another adapter must not disable builtin
        // OpenTUI certification in a mixed process.
        if (typeof framework === 'string' && framework !== 'opentui') return false;
      }
    } catch {
      // A malformed profile could have intended to bind OpenTUI. Fail closed.
    }
    return true;
  }
  return (
    env['TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST'] !== undefined ||
    env['TERMWRIGHT_CERTIFICATION_SOURCE_REVISION'] !== undefined
  );
}

function entryPath(entry: string): string | undefined {
  const clean = entry.split('?')[0] ?? '';
  try {
    return clean.startsWith('file:') ? fileURLToPath(clean) : clean;
  } catch {
    return undefined;
  }
}

function certificationOverride(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeCertification | undefined {
  const raw = env['TERMWRIGHT_CERTIFICATION_HOOK_PROFILE'];
  const digest = env['TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST'];
  const revision = env['TERMWRIGHT_CERTIFICATION_SOURCE_REVISION'];
  if (
    raw === undefined ||
    env['GITHUB_ACTIONS'] !== 'true' ||
    !/^sha256:[a-f0-9]{64}$/u.test(digest ?? '') ||
    !/^[a-f0-9]{40}$/u.test(revision ?? '') ||
    revision !== env['GITHUB_SHA']
  )
    return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value['framework'] !== 'opentui' ||
      typeof value['version'] !== 'string' ||
      value['candidateDigest'] !== digest ||
      value['sourceRevision'] !== revision
    )
      return undefined;
    return Object.freeze({
      version: value['version'],
      source: 'candidate',
      candidateDigest: digest as string,
      sourceRevision: revision as string,
    });
  } catch {
    return undefined;
  }
}
