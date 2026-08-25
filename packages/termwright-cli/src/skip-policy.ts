/** Repository-owned declarations for native tests that are intentionally inapplicable. */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NativeTestSkipDeclaration } from './test-host.js';

interface SkipRuleFile {
  readonly version: 1;
  readonly rules: readonly {
    readonly id: string;
    readonly file: string;
    readonly suite?: string;
    readonly fullName: string;
    readonly platforms?: readonly NodeJS.Platform[];
    readonly required?: boolean;
  }[];
}

interface PlatformDeviationFile {
  readonly version: 1;
  readonly deviations: readonly {
    readonly id: string;
    readonly predicate: 'win32' | 'non-win32';
    readonly tests: readonly (readonly [string, string])[];
    /** Exact native leaf cases represented by a source-level skipped suite. */
    readonly skipPolicyTests?: readonly (readonly [string, string])[];
  }[];
}

const NODE_PLATFORMS = Object.freeze([
  'aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd',
] as const satisfies readonly NodeJS.Platform[]);

/**
 * Loads the repository's exact skip contract without making it a package API.
 * Missing files mean “no skips declared”, never “allow whatever Vitest skipped”.
 */
export async function loadRepositorySkipDeclarations(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Promise<readonly NativeTestSkipDeclaration[]> {
  const declarations: NativeTestSkipDeclaration[] = [];
  const applicability = await optionalJson(join(cwd, 'quality', 'applicability-skips.json'));
  if (applicability !== undefined) {
    const policy = parseSkipRules(applicability);
    for (const rule of policy.rules) {
      if (rule.platforms !== undefined && !rule.platforms.includes(platform)) continue;
      declarations.push(Object.freeze({
        id: rule.id,
        file: rule.file,
        ...(rule.suite === undefined ? {} : { suite: rule.suite }),
        fullName: rule.fullName,
        required: rule.required === true,
      }));
    }
  }
  const platformPolicy = await optionalJson(join(cwd, 'quality', 'platform-deviations.json'));
  if (platformPolicy !== undefined) {
    const registry = parsePlatformDeviations(platformPolicy);
    for (const deviation of registry.deviations) {
      const applicable = deviation.predicate === 'win32' ? platform === 'win32' : platform !== 'win32';
      if (!applicable) continue;
      for (const [file, fullName] of deviation.skipPolicyTests ?? deviation.tests) {
        declarations.push(Object.freeze({
          id: `${deviation.id}:${file}:${fullName}`,
          file,
          fullName,
          required: true,
        }));
      }
    }
  }
  const ids = new Set<string>();
  for (const declaration of declarations) {
    if (ids.has(declaration.id)) throw new TypeError(`duplicate skip declaration ${declaration.id}`);
    ids.add(declaration.id);
  }
  return Object.freeze(declarations);
}

async function optionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`cannot load native skip policy ${path}`, { cause: error });
  }
}

function parseSkipRules(value: unknown): SkipRuleFile {
  if (!record(value) || value['version'] !== 1 || !Array.isArray(value['rules'])) {
    throw new TypeError('quality/applicability-skips.json must contain version 1 and a rules array');
  }
  for (const rule of value['rules']) {
    if (!record(rule) || !nonEmpty(rule['id']) || !nonEmpty(rule['file']) || !nonEmpty(rule['fullName'])) {
      throw new TypeError('each applicability skip needs non-empty id, file and fullName');
    }
    if (rule['required'] !== undefined && typeof rule['required'] !== 'boolean') {
      throw new TypeError(`applicability skip ${String(rule['id'])} has an invalid required flag`);
    }
    if (rule['suite'] !== undefined && !nonEmpty(rule['suite'])) {
      throw new TypeError(`applicability skip ${String(rule['id'])} has an invalid exact suite scope`);
    }
    if (rule['platforms'] !== undefined &&
        (!Array.isArray(rule['platforms']) || !rule['platforms'].every((platform) =>
          typeof platform === 'string' && NODE_PLATFORMS.includes(platform as NodeJS.Platform)))) {
      throw new TypeError(`applicability skip ${String(rule['id'])} has invalid platforms`);
    }
  }
  return value as unknown as SkipRuleFile;
}

function parsePlatformDeviations(value: unknown): PlatformDeviationFile {
  if (!record(value) || value['version'] !== 1 || !Array.isArray(value['deviations'])) {
    throw new TypeError('quality/platform-deviations.json must contain version 1 and a deviations array');
  }
  for (const deviation of value['deviations']) {
    if (!record(deviation) || !nonEmpty(deviation['id']) ||
        (deviation['predicate'] !== 'win32' && deviation['predicate'] !== 'non-win32') ||
        !Array.isArray(deviation['tests'])) {
      throw new TypeError('platform deviation has an invalid skip contract');
    }
    for (const test of deviation['tests']) {
      if (!Array.isArray(test) || test.length !== 2 || !test.every(nonEmpty)) {
        throw new TypeError(`platform deviation ${String(deviation['id'])} has an invalid test reference`);
      }
    }
    if (deviation['skipPolicyTests'] !== undefined) {
      if (!Array.isArray(deviation['skipPolicyTests'])) {
        throw new TypeError(`platform deviation ${String(deviation['id'])} has invalid exact skip-policy cases`);
      }
      for (const test of deviation['skipPolicyTests']) {
        if (!Array.isArray(test) || test.length !== 2 || !test.every(nonEmpty)) {
          throw new TypeError(`platform deviation ${String(deviation['id'])} has an invalid exact skip-policy reference`);
        }
      }
    }
  }
  return value as unknown as PlatformDeviationFile;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8_192;
}
