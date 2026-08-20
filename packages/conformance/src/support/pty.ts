/**
 * Shared harness plumbing for the conformance suites: fixture resolution,
 * pseudo-terminal availability and session bookkeeping.
 *
 * Every suite in this package drives real child processes. Where no PTY can be
 * opened — a sandboxed CI runner, a missing prebuild — the suites skip rather
 * than fail, because "this machine cannot open a terminal" is not a conformance
 * result. Set `TERMWRIGHT_SKIP_PTY=1` to skip them explicitly.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchTerminal, createNodePtyBackend, type LaunchOptions, type TerminalHarness } from '@termwright/driver';
import { withProbe } from '@termwright/probe-ink';

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

/**
 * Absolute path inside the repository, for suites that reach outside this
 * package — the language clients live in `clients/`, not in `packages/`.
 */
export function repositoryPath(...segments: readonly string[]): string {
  return join(packageRoot(), '..', '..', ...segments);
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
  /** Shell-shaped app emitting OSC 133 marks; `--marks=off` suppresses them. */
  prompt: () => fixturePath('prompt-app.mjs'),
  /** Normal-render Ink app used to exercise launch-time probe attachment. */
  inkProbe: () => fixturePath('ink-probe-app.mjs'),
  /** Hostile wire peer; takes a scenario name as its first argument (§20.3). */
  adversarialPeer: () => fixturePath('adversarial-peer.mjs'),
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

/**
 * Absolute path of a Python interpreter that can import the given modules.
 *
 * Two problems at once. The executable is `python3` on POSIX and often only
 * `python` on Windows, and `node-pty` resolves neither reliably — the first
 * Windows run failed with `File not found:` while a `spawnSync` probe of the
 * same name had just succeeded. Asking the interpreter for `sys.executable`
 * turns whichever name works into an absolute path a pty can spawn.
 *
 * @returns the interpreter path, or `null` when no candidate can import them.
 */
export function pythonWith(modules: readonly string[]): string | null {
  const script = `import ${modules.join(', ')}, sys; print(sys.executable)`;
  for (const candidate of ['python3', 'python']) {
    if (!commandAvailable([candidate, '-c', `import ${modules.join(', ')}`], { quiet: true })) continue;
    const resolved = spawnSync(candidate, ['-c', script], { encoding: 'utf8', env: environment() });
    const path = (resolved.stdout ?? '').trim();
    if (resolved.status === 0 && path.length > 0) return path;
  }
  return null;
}

/** Options every conformance session shares; suites override what they need. */
export interface FixtureLaunchOptions extends Partial<Omit<LaunchOptions, 'command'>> {
  /** Extra arguments appended to `node <fixture>`. */
  readonly args?: readonly string[];
  /** Attach the zero-config framework probe to the otherwise normal command. */
  readonly probe?: 'ink';
  /**
   * Text that proves the fixture started drawing. Waiting for it here rather
   * than in each suite is what lets the failure be diagnosed: a fixture that
   * printed nothing at all failed to start, which is a very different problem
   * from one that started and drew the wrong thing.
   */
  readonly ready?: string | RegExp;
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
      const { args = [], probe, ready: _ready, ...launchOptions } = options;
      const base = [process.execPath, fixture, ...args];
      const terminal = await launchTerminal({
        command: probe === 'ink' ? withProbe('node', base).command : base,
        columns: 80,
        rows: 24,
        // No `env` and no `envMode`: the suites run against the secret-safe
        // 'replace' default, which is what a user gets. Forwarding the runner's
        // whole environment here would quietly make every suite an 'inherit'
        // test and leave the default uncovered.
        // Conformance runs start a fresh Node process, a pseudo-terminal and a
        // socket per test, and several suites run beside other builds. The
        // driver's defaults are tight enough that machine load, rather than the
        // implementation, would decide the result — a genuine failure still
        // fails here, just later.
        timeouts: { text: 30_000, action: 30_000, exit: 30_000, idle: 10_000 },
        ...launchOptions,
      });
      open.push(terminal);
      if (options.ready !== undefined) await waitForStart(terminal, options.ready, fixture);
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

/**
 * Waits for a fixture's first output, and says which way it failed.
 *
 * `waitForText` can only report that text never appeared, which reads as a
 * rendering problem. Distinguishing "the child wrote nothing at all" from "the
 * child wrote something else" is the difference between hunting a fixture bug
 * and hunting a spawn or scheduling one — and on a heavily loaded machine it is
 * always the latter.
 */
async function waitForStart(
  terminal: TerminalHarness,
  ready: string | RegExp,
  fixture: string,
): Promise<void> {
  let bytes = 0;
  const off = terminal.events.on('output', ({ data }) => {
    bytes += data.length;
  });
  try {
    await terminal.waitForText(ready);
  } catch (error) {
    const exit = await Promise.race([terminal.exit, Promise.resolve(null)]);
    const detail =
      bytes === 0
        ? `it produced no output at all${exit === null ? ' and is still running' : `; it exited ${JSON.stringify(exit)}`}`
        : `it produced ${bytes} bytes but never drew ${String(ready)}`;
    throw new Error(`conformance: ${fixture.split('/').pop() ?? fixture} did not start — ${detail}`, {
      cause: error,
    });
  } finally {
    off();
  }
}

/**
 * Whether a toolchain command succeeds here.
 *
 * Used to decide, at collection time, whether an adapter written in another
 * language can be certified on this machine at all. A missing interpreter is
 * not a conformance result, so the suite skips and says why — the same rule as
 * a missing pseudo-terminal.
 *
 * @param command - argv to run; exit status 0 counts as available.
 * @returns `false` when the command is missing, fails, or exceeds `timeoutMs`.
 *
 * @example
 * ```ts
 * commandAvailable(['python3', '-c', 'import textual']);
 * ```
 */
export function commandAvailable(
  command: readonly string[],
  options: { readonly cwd?: string; readonly timeoutMs?: number; readonly quiet?: boolean } = {},
): boolean {
  const [binary, ...args] = command;
  if (binary === undefined) return false;
  const printable = command.join(' ');
  try {
    const result = spawnSync(binary, args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      timeout: options.timeoutMs ?? 120_000,
      encoding: 'utf8',
      env: environment(),
    });
    if (result.status === 0) return true;
    // A skipped suite has to say *why* it skipped, or a probe that broke looks
    // exactly like a toolchain that was never installed.
    if (options.quiet === true) return false;
    const reason =
      result.error?.message ??
      (result.signal === null ? `exit ${String(result.status)}` : `signal ${result.signal}`);
    process.stderr.write(
      `conformance: probe \`${printable}\` failed (${reason})\n` +
        `${(result.stderr ?? '').trim().split('\n').slice(-3).join('\n')}\n`,
    );
    return false;
  } catch (error) {
    if (options.quiet !== true) {
      process.stderr.write(
        `conformance: probe \`${printable}\` could not run: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return false;
  }
}

/**
 * Turns on the child's mouse reporting and reports whether the emulator can
 * see that it happened.
 *
 * ConPTY consumes the child's DECSET, so on Windows the mode reads `'unknown'`
 * — the child did enable tracking, the terminal just cannot say so. Branching
 * on the *observed* mode rather than on `process.platform` keeps one code path:
 * a platform that starts reporting the mode tightens the assertions by itself,
 * and one that stops loosens them, without anyone editing a list of platforms.
 *
 * @returns `true` when the mode is observable, so mode-specific claims (an
 * exact tracking level, a refusal for the wrong level) can be asserted.
 */
export async function enableMouseReporting(
  terminal: TerminalHarness,
  mode: 'click' | 'drag',
): Promise<boolean> {
  const expected = mode === 'click' ? 'vt200' : 'drag';
  await terminal.press(mode === 'click' ? 'm' : 'M');
  await pollUntil(() => {
    const tracking = terminal.screen().modes.mouseTracking;
    return tracking === expected || tracking === 'unknown';
  });
  return terminal.screen().modes.mouseTracking === expected;
}

/**
 * Asks the child to enable focus reporting and reports what the emulator made
 * of it.
 *
 * Same shape as the mouse, and the same three answers: `'on'` where the DECSET
 * was seen, `'unknown'` where the platform reports the host's state rather than
 * the child's — ConPTY does that — and `'off'` only while the request is still
 * in flight. Waiting for a settled answer is what keeps the caller off the
 * third: branching on `'off'` would mean branching on how loaded the machine
 * is, which is how this last flaked.
 */
export async function enableFocusReporting(
  terminal: TerminalHarness,
): Promise<'on' | 'off' | 'unknown'> {
  await terminal.press('f');
  await pollUntil(() => terminal.screen().modes.focusReporting !== 'off', 3_000).catch(
    () => undefined,
  );
  return terminal.screen().modes.focusReporting;
}

/**
 * Runs a burst out and answers where the published revision came to rest.
 *
 * A wall-clock budget for "two hundred revisions arrived" is a bet on the
 * platform's throughput, and it is the wrong question: what a burst settles on
 * depends on how far the terminal falls behind the socket while it is running,
 * which is the platform's business. Measured rather than assumed — the caller
 * then asserts what is true of the answer it got. `target` only bounds the
 * wait; reaching it is not required here.
 */
export async function settledRevision(
  terminal: TerminalHarness,
  target: number,
  stallMs = 15_000,
): Promise<number> {
  let seen = terminal.semanticTree()?.revision ?? 0;
  let progressed = Date.now();
  for (;;) {
    const current = terminal.semanticTree()?.revision ?? 0;
    if (current >= target) return current;
    if (current > seen) {
      seen = current;
      progressed = Date.now();
    }
    if (Date.now() - progressed > stallMs) return seen;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 25);
      timer.unref?.();
    });
  }
}

/** How many times each diagnostic code was recorded — for failure messages. */
export function diagnosticTally(terminal: TerminalHarness): string {
  const counts = new Map<string, number>();
  for (const entry of terminal.diagnostics()) {
    counts.set(entry.code, (counts.get(entry.code) ?? 0) + 1);
  }
  return [...counts].map(([code, count]) => `${code}×${count}`).join(', ') || 'none';
}

/** What the emulator currently makes of the child's focus-reporting request. */
export function focusMode(terminal: TerminalHarness): 'on' | 'off' | 'unknown' {
  return terminal.screen().modes.focusReporting;
}

/** True while the emulator cannot see which mouse mode the child asked for. */
export function mouseModeHidden(terminal: TerminalHarness): boolean {
  return terminal.screen().modes.mouseTracking === 'unknown';
}

/** Polls a predicate until it holds, or throws once the budget is spent. */
export async function pollUntil(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() >= deadline) throw new Error('conformance: condition never became true');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 25);
      timer.unref?.();
    });
  }
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
