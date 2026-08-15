/**
 * Shared harness plumbing for the conformance suites: fixture resolution,
 * pseudo-terminal availability and session bookkeeping.
 *
 * Every suite in this package drives real child processes. Where no PTY can be
 * opened — a sandboxed CI runner, a missing prebuild — the suites skip rather
 * than fail, because "this machine cannot open a terminal" is not a conformance
 * result. Set `TERMWRIGHT_SKIP_PTY=1` to skip them explicitly.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchTerminal, createNodePtyBackend, type LaunchOptions, type TerminalHarness } from '@termwright/driver';

/**
 * Absolute path of a fixture that ships with this package.
 *
 * The fixtures are shipped as sources rather than bundled, because they are
 * meant to be launched as `node <path>` by suites in other packages and in
 * other languages' CI. They are therefore located from the package root, which
 * is the one anchor that is the same whether this module was loaded from `src/`
 * during development or from the bundled `dist/`.
 */
export function fixturePath(name: string): string {
  return join(packageRoot(), 'src', 'fixtures', name);
}

let cachedRoot: string | null = null;

function packageRoot(): string {
  if (cachedRoot !== null) return cachedRoot;
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(directory, 'package.json'))) {
      cachedRoot = directory;
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error('@termwright/conformance: could not locate the package root from this module');
    }
    directory = parent;
  }
}

/** The fixtures published for adapter authors and other packages' suites. */
export const CONFORMANCE_FIXTURES = Object.freeze({
  /** Uninstrumented app: proves the generic fallback (§20.1). */
  generic: () => fixturePath('generic-app.mjs'),
  /** Instrumented Ink app covering the semantic matrix (§20.2). */
  semanticInk: () => fixturePath('semantic-ink-app.mjs'),
  /** Hostile wire peer; takes a scenario name as its first argument (§20.3). */
  adversarialPeer: () => fixturePath('adversarial-peer.mjs'),
  /** Process-mode half of the component harness matrix (§20.2a). */
  component: () => fixturePath('component-app.mjs'),
  /** The component itself, importable by an in-process harness (§20.2a). */
  componentModule: () => fixturePath('component.mjs'),
});

let cachedPty: boolean | null = null;

/**
 * Whether this machine can open a pseudo-terminal at all.
 *
 * @returns `false` when `TERMWRIGHT_SKIP_PTY=1` or spawning a trivial child
 * through the PTY backend throws. Probed once and cached.
 */
export function ptyAvailable(): boolean {
  if (cachedPty !== null) return cachedPty;
  if (process.env['TERMWRIGHT_SKIP_PTY'] === '1') {
    cachedPty = false;
    return cachedPty;
  }
  try {
    const pty = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', 'process.exit(0)'],
      env: environment(),
      columns: 20,
      rows: 4,
    });
    pty.dispose();
    cachedPty = true;
  } catch {
    cachedPty = false;
  }
  return cachedPty;
}

/** `process.env` with the `undefined` values dropped, as PTY spawning requires. */
export function environment(extra?: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/** Options every conformance session shares; suites override what they need. */
export interface FixtureLaunchOptions extends Partial<Omit<LaunchOptions, 'command'>> {
  /** Extra arguments appended to `node <fixture>`. */
  readonly args?: readonly string[];
}

/**
 * A set of sessions closed together, so one wedged fixture cannot leak a child
 * process into the next test.
 *
 * @example
 * ```ts
 * const sessions = createSessionPool();
 * afterEach(sessions.closeAll);
 * const terminal = await sessions.launch(CONFORMANCE_FIXTURES.generic());
 * ```
 */
export interface SessionPool {
  launch(fixture: string, options?: FixtureLaunchOptions): Promise<TerminalHarness>;
  closeAll(): Promise<void>;
}

export function createSessionPool(): SessionPool {
  const open: TerminalHarness[] = [];
  return {
    async launch(fixture, options = {}) {
      const { args = [], ...launchOptions } = options;
      const terminal = await launchTerminal({
        command: [process.execPath, fixture, ...args],
        columns: 80,
        rows: 24,
        env: environment(),
        // Conformance runs start a fresh Node process, a pseudo-terminal and a
        // socket per test. On a loaded CI box the defaults are tight enough
        // that machine load, not the implementation, decides the result.
        timeouts: { text: 15_000, action: 15_000, exit: 15_000 },
        ...launchOptions,
      });
      open.push(terminal);
      return terminal;
    },
    async closeAll() {
      while (open.length > 0) {
        const terminal = open.pop();
        await terminal?.close();
      }
    },
  };
}

/** Catch helper: awaits a rejection and returns the error, typed. */
export async function rejection<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}
