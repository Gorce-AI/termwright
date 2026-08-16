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
import { discoveredId } from './test-model.js';

export { discoveredId, parseDiscoveredId } from './test-model.js';

/** One test the project holds. */
export interface DiscoveredTest {
  /** `<file>::<full name>` — parseable back into a Vitest invocation. */
  readonly id: string;
  /** Full name, as Vitest prints it: `suite > case`. */
  readonly title: string;
  readonly file: string;
}

/** Options for {@link discoverTests}. */
export interface DiscoveryOptions {
  /** Directory the command runs in. */
  readonly cwd: string;
  /** Command to run. Default `npx vitest list --json`. */
  readonly command?: readonly string[];
  /** Milliseconds before the listing is abandoned. Default 30 000. */
  readonly timeoutMs?: number;
  /** Injectable runner, so tests do not spawn Vitest. */
  readonly run?: (options: DiscoveryOptions) => Promise<string>;
}

/** Maximum tests kept from one listing. */
const MAX_TESTS = 10_000;
const DEFAULT_COMMAND = ['npx', 'vitest', 'list', '--json'] as const;
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
    const id = discoveredId(file, title);
    if (seen.has(id)) continue; // a parameterised test can list twice
    seen.add(id);
    tests.push({ id, title, file });
  }
  return tests;
}

/** Runs the listing command and returns its stdout. */
async function runCommand(options: DiscoveryOptions): Promise<string> {
  const [command, ...args] = options.command ?? DEFAULT_COMMAND;
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
