/**
 * Test discovery: what the project *has*, before anything runs.
 *
 * Opening the runner on an empty list and having to guess what a run would
 * contain is the difference between a test runner and a log viewer. Vitest can
 * be asked (`vitest list --json`), so the server asks — at startup and whenever
 * the files change — and the panel shows every test the project holds, marked
 * as not run yet.
 *
 * Vitest's listing carries a name and a file and **no id**, so ids are
 * synthesised as `<file>::<name>`. That is deliberate: it is stable across
 * runs, it reconciles with a running test by file and title, and a runner
 * receiving it in `rerun { testIds }` can turn it back into
 * `vitest run <file> -t "<name>"` without a lookup table.
 *
 * @packageDocumentation
 */

import { spawn } from 'node:child_process';
import { canonicalTestFile, discoveredId } from './test-model.js';

export { canonicalTestFile, discoveredId, parseDiscoveredId } from './test-model.js';

export type DiscoveredTestKind = 'test' | 'gherkin-scenario' | 'gherkin-outline-example';

export interface DiscoveredTestSource {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface DiscoveredTestAncestor {
  readonly kind: 'feature' | 'rule';
  readonly title: string;
}

/** One test the project holds. */
export interface DiscoveredTest {
  /** `<file>::<full name>` — parseable back into a Vitest invocation. */
  readonly id: string;
  /** Full name, as Vitest prints it: `suite > case`. */
  readonly title: string;
  readonly file: string;
  /** Declaration-time provider identity. Never inferred from an import path or title. */
  readonly provider?: { readonly id: string; readonly version: number };
  /** Provider-authored catalogue kind. */
  readonly kind?: DiscoveredTestKind;
  /** Provider-authored hierarchy, outermost first. */
  readonly ancestors?: readonly DiscoveredTestAncestor[];
  readonly tags?: readonly string[];
  /** Physical authoring location, which can differ from the transformed module location. */
  readonly source?: DiscoveredTestSource;
}

/** Options for {@link discoverTests}. */
export interface DiscoveryOptions {
  /** Directory the command runs in. */
  readonly cwd: string;
  /** Command to run. Default `npx vitest list --json`. */
  readonly command?: readonly string[];
  /** Existing Vitest filters/options, so discovery matches the CLI's scope. */
  readonly args?: readonly string[];
  /** Milliseconds before the listing is abandoned. Default 30 000. */
  readonly timeoutMs?: number;
  /** Injectable runner, so tests do not spawn Vitest. */
  readonly run?: (options: DiscoveryOptions) => Promise<string>;
}

/** Maximum tests kept from one listing. */
const MAX_TESTS = 10_000;
const DEFAULT_COMMAND = ['npx', 'vitest', 'list'] as const;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Lists the project's tests.
 *
 * @returns the tests, or an empty list when the command fails — a project
 * without Vitest, a config error, a missing binary. Discovery is a convenience;
 * failing it must never stop the runner from showing a run.
 *
 * @example
 * ```ts
 * const tests = await discoverTests({ cwd: process.cwd() });
 * tests[0]?.title; // 'the todo app > starts on the list it was seeded with'
 * ```
 */
export async function discoverTests(options: DiscoveryOptions): Promise<readonly DiscoveredTest[]> {
  let output: string;
  try {
    output = await (options.run ?? runCommand)(options);
  } catch {
    return [];
  }
  return parseListing(output);
}

/** Parses `vitest list --json`, validating it as the external data it is. */
export function parseListing(output: string): readonly DiscoveredTest[] {
  const start = output.indexOf('[');
  if (start === -1) return [];
  let parsed: unknown;
  try {
    // Vitest prints the array after whatever its reporters wrote first.
    parsed = JSON.parse(output.slice(start));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const tests: DiscoveredTest[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (tests.length >= MAX_TESTS) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const title = record['name'];
    const file = record['file'];
    if (typeof title !== 'string' || title === '' || typeof file !== 'string' || file === '') continue;
    const canonicalFile = canonicalTestFile(file);
    const id = discoveredId(canonicalFile, title);
    if (seen.has(id)) continue; // a parameterised test can list twice
    seen.add(id);
    const provider = parseProvider(record['provider']);
    const kind = parseKind(record['kind']);
    const ancestors = parseAncestors(record['ancestors']);
    const tags = parseStringList(record['tags']);
    const source = parseSource(record['source']);
    tests.push({
      id,
      title,
      file: canonicalFile,
      ...(provider === undefined ? {} : { provider }),
      ...(kind === undefined ? {} : { kind }),
      ...(ancestors === undefined ? {} : { ancestors }),
      ...(tags === undefined ? {} : { tags }),
      ...(source === undefined ? {} : { source }),
    });
  }
  return tests;
}

function parseProvider(value: unknown): DiscoveredTest['provider'] {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string' || record['id'] === '') return undefined;
  if (!Number.isInteger(record['version']) || (record['version'] as number) < 1) return undefined;
  return { id: record['id'], version: record['version'] as number };
}

function parseKind(value: unknown): DiscoveredTestKind | undefined {
  return value === 'test' || value === 'gherkin-scenario' || value === 'gherkin-outline-example'
    ? value
    : undefined;
}

function parseAncestors(value: unknown): readonly DiscoveredTestAncestor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ancestors: DiscoveredTestAncestor[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return undefined;
    const record = item as Record<string, unknown>;
    if (record['kind'] !== 'feature' && record['kind'] !== 'rule') return undefined;
    if (typeof record['title'] !== 'string' || record['title'] === '') return undefined;
    ancestors.push({ kind: record['kind'], title: record['title'] });
  }
  return ancestors;
}

function parseStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item !== '')) {
    return undefined;
  }
  return value;
}

function parseSource(value: unknown): DiscoveredTestSource | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record['file'] !== 'string' || record['file'] === '') return undefined;
  if (!Number.isInteger(record['line']) || (record['line'] as number) < 1) return undefined;
  if (!Number.isInteger(record['column']) || (record['column'] as number) < 1) return undefined;
  return {
    file: canonicalTestFile(record['file']),
    line: record['line'] as number,
    column: record['column'] as number,
  };
}

/** Runs the listing command and returns its stdout. */
async function runCommand(options: DiscoveryOptions): Promise<string> {
  const [command, ...args] = options.command ?? defaultDiscoveryCommand(options.args);
  if (command === undefined) throw new Error('discovery: empty command');

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('discovery: listing timed out'));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      // A listing this large is a project doing something unusual; stop reading
      // rather than buffer without bound.
      if (stdout.length < 32 * 1024 * 1024) stdout += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`discovery: listing exited with ${String(code)}`));
    });
  });
}

/**
 * Builds the default command with `--json` last.
 *
 * Vitest's `--json` accepts an optional output path. Putting a positional test
 * filter immediately after it makes Vitest overwrite that test file with the
 * listing. Keeping the flag last is therefore a data-safety invariant, not a
 * cosmetic CLI preference.
 */
export function defaultDiscoveryCommand(args: readonly string[] = []): readonly string[] {
  return [...DEFAULT_COMMAND, ...args, '--json'];
}
