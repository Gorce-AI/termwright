/**
 * `launchInkFixture` — the same component, in a real pseudo-terminal.
 *
 * `mountInk` models the terminal faithfully but the *process* is a fiction:
 * stdin is a stream this package pushes to, raw mode is a boolean, and a signal
 * is an unmount. When those are the thing under test — a component that reads
 * `process.stdin.isRaw`, one that must survive `SIGINT`, one whose layout
 * depends on a real `SIGWINCH` — the component belongs in a fixture process
 * behind a real pty. Everything else about the harness is identical.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  launchTerminal,
  ProcessExitedError,
  SessionClosedError,
  TimeoutError,
  type AppLogSource,
  type EnvMode,
  type TerminalHarness,
  type TimeoutClasses,
} from '@termwright/driver';
import { withProbe } from '@termwright/probe-ink';
import { ControlChannel, ENV_CONTROL_ENDPOINT, ENV_CONTROL_TOKEN } from './control.js';
import { ForwardingHarness } from './forwarding.js';
import { encodeFixturePayload, type JsonProps } from './payload.js';
import { waitForFirstFrame, type SettleOptions } from './settle.js';

/** Options for {@link launchInkFixture}. */
export interface LaunchInkFixtureOptions {
  /**
   * The module holding the component: an absolute path or a `file:` URL.
   *
   * It is imported by the fixture process, so it must be something Node can
   * load directly — `.js`/`.mjs`, or `.ts` if the fixture runs under a loader
   * passed in {@link LaunchInkFixtureOptions.nodeArgs}.
   */
  readonly component: string | URL;
  /** Export to render. Default `default`. */
  readonly exportName?: string;
  /** Props for the component, transferred as bounded JSON. Never functions. */
  readonly props?: JsonProps;
  /** Terminal width in cells. Default 80. */
  readonly columns?: number;
  /** Terminal height in cells. Default 24. */
  readonly rows?: number;
  /** Working directory of the fixture process. */
  readonly cwd?: string;
  /** Extra environment variables for the fixture process. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * How the fixture's environment is built, as in `launchTerminal`. Default
   * `'replace'`: the process starts from a documented allowlist plus
   * {@link LaunchInkFixtureOptions.env}, so a variable on a developer's laptop
   * cannot change what CI sees.
   *
   * Unlike a mount, this is real isolation — the fixture is a separate process
   * and its `process.env` is exactly what the driver built. Pass `'inherit'`
   * when the component genuinely needs the runner's environment.
   */
  readonly envMode?: EnvMode;
  /**
   * Log files to follow for the lifetime of the fixture, as in
   * `launchTerminal`. Entries arrive on the session timeline as `app-log`
   * events; `collectLogs` in `@termwright/test` reads them off the harness.
   */
  readonly logs?: readonly AppLogSource[];
  /** Arguments inserted before the runner, e.g. `['--import', 'tsx']`. */
  readonly nodeArgs?: readonly string[];
  /** Driver timeout classes, as in `launchTerminal`. */
  readonly timeouts?: TimeoutClasses;
  /** How long the fixture may take to commit its first frame. */
  readonly settleTimeout?: number;
}

/**
 * A {@link TerminalHarness} over a fixture process, plus the prop update only a
 * control channel can deliver.
 */
export interface InkFixtureHarness extends TerminalHarness {
  /**
   * Replaces the fixture's props and resolves once the resulting frame has been
   * committed and published.
   *
   * The counterpart of `InkHarness.rerender`, and deliberately not the same
   * signature: a mount takes a React element because it shares a heap with the
   * test, while a fixture is another process and can only be sent data. Props
   * cross as bounded JSON over a private socket — never over stdin, which
   * belongs to the simulated user, and never as code.
   *
   * The *component* is fixed when the fixture starts and is never re-resolved
   * from a message: a rerender changes what it is showing, never which code
   * runs.
   */
  rerender(props: JsonProps, opts?: SettleOptions): Promise<void>;
}

/**
 * Ink's frame cap inside a fixture. Matches the mount so that a component
 * behaves the same in both modes.
 */
const FIXTURE_MAX_FPS = 1_000;

/** How long a fixture may take to attach to the control channel. */
const CONTROL_ATTACH_TIMEOUT_MS = 5_000;
const DEFAULT_RERENDER_TIMEOUT_MS = 5_000;

/** The runner lives next to `dist/`, one level below the package root. */
const RUNNER_ENTRY = new URL('../runner/runner-entry.mjs', import.meta.url);

/**
 * Starts a fixture process in a real pty and returns a harness over it.
 *
 * The fixture renders `component`'s export with normal Ink under the same
 * injected probe a production app uses, in the alternate screen, so its tree
 * matches what `mountInk` produces for the same element.
 *
 * @example
 * ```ts
 * const harness = await launchInkFixture({
 *   component: new URL('./counter-app.mjs', import.meta.url),
 *   props: { label: 'Approve' },
 *   columns: 40,
 *   rows: 10,
 * });
 * await harness.press('Enter');
 * await harness.waitForText('pressed 1');
 * await harness.close();
 * ```
 */
export async function launchInkFixture(
  options: LaunchInkFixtureOptions,
): Promise<InkFixtureHarness> {
  const payload = encodeFixturePayload({
    v: 1,
    module: moduleUrl(options.component),
    exportName: options.exportName ?? 'default',
    props: options.props ?? {},
    maxFps: FIXTURE_MAX_FPS,
  });

  // Created before the process starts, so the address exists by the time the
  // runner looks for it and no connection can be missed.
  const control = await ControlChannel.listen();

  let harness: TerminalHarness;
  try {
    harness = await launchTerminal({
      command: withProbe('node', [
        process.execPath,
        ...(options.nodeArgs ?? []),
        fileURLToPath(RUNNER_ENTRY),
        payload,
      ]).command,
      columns: options.columns ?? 80,
      rows: options.rows ?? 24,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: {
        ...options.env,
        [ENV_CONTROL_ENDPOINT]: control.endpoint,
        [ENV_CONTROL_TOKEN]: control.token,
      },
      ...(options.envMode === undefined ? {} : { envMode: options.envMode }),
      ...(options.logs === undefined ? {} : { logs: options.logs }),
      ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
      // Unlike launchTerminal's generic API, this helper always injects the Ink
      // integration. Do not let the generic bounded negotiation window classify
      // a loaded Windows child as uninstrumented before its imports complete.
      semanticNegotiationMs: options.settleTimeout ?? CONTROL_ATTACH_TIMEOUT_MS,
    });
  } catch (error) {
    try {
      await control.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Ink fixture launch and control-channel rollback both failed',
        { cause: error },
      );
    }
    throw error;
  }

  // A fixture that fails to start — a missing export, a module that throws on
  // import — still paints the terminal, because the runner's diagnostics go to
  // the same tty. Waiting for a frame alone would hand back a harness over a
  // dead process, so the exit races the first frame and wins.
  const died = harness.exit.then((status) => {
    throw new ProcessExitedError(
      `the fixture exited before rendering (code ${String(status.code)}, signal ${String(status.signal)})`,
      {
        semanticTree: false,
        screenExcerpt: harness.screen().text(),
        suggestion: 'the screen excerpt holds the runner diagnostics written to stderr',
      },
    );
  });
  died.catch(() => undefined);

  try {
    await Promise.race([
      waitForFirstFrame(
        harness,
        options.settleTimeout === undefined
          ? undefined
          : ({ timeout: options.settleTimeout } satisfies SettleOptions),
      ),
      died,
    ]);
  } catch (error) {
    await closeFixtureResources(control, harness, error);
    throw error;
  }

  return new InkFixtureHarnessImpl(
    harness,
    control,
    options.settleTimeout === undefined ? undefined : { timeout: options.settleTimeout },
  );
}

/**
 * The session, plus `rerender`, plus a `close` that takes the control channel
 * down with it.
 *
 * Built on the same explicit forwarder as `mountInk` rather than on a
 * prototype trick: the driver's session keeps its state in private fields, so
 * an object that merely inherits from it throws on the first method call —
 * which typechecks perfectly and fails at runtime.
 */
class InkFixtureHarnessImpl extends ForwardingHarness implements InkFixtureHarness {
  readonly #control: ControlChannel;
  readonly #settle: SettleOptions | undefined;
  #rerenderTail: Promise<void> = Promise.resolve();
  #closePromise: Promise<void> | null = null;

  constructor(
    session: TerminalHarness,
    control: ControlChannel,
    settle: SettleOptions | undefined,
  ) {
    super(session);
    this.#control = control;
    this.#settle = settle;
    void session.exit.then(() => control.fixtureExited());
  }

  rerender(props: JsonProps, opts?: SettleOptions): Promise<void> {
    // Frame observers are also single-command state: registering two before
    // either command is sent would let both observe the first commit. Queue the
    // complete send + paired-frame operation, not merely the socket write.
    const run = this.#rerenderTail.then(() => this.#rerenderOne(props, opts));
    this.#rerenderTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #rerenderOne(props: JsonProps, opts?: SettleOptions): Promise<void> {
    const settle = opts ?? this.#settle;
    const deadline = performance.now() + (settle?.timeout ?? DEFAULT_RERENDER_TIMEOUT_MS);
    await this.#control.waitForFixture(remainingRerenderTime(deadline, this.session));
    const paired = pairedRevisionObserver(this.session, deadline);
    try {
      const revision = await this.#control.rerender(
        props,
        remainingRerenderTime(deadline, this.session),
      );
      await paired.waitFor(revision);
    } finally {
      paired.close();
    }
  }

  override close(): Promise<void> {
    this.#closePromise ??= closeFixtureResources(this.#control, this.session);
    return this.#closePromise;
  }
}

async function closeFixtureResources(
  control: ControlChannel,
  harness: TerminalHarness,
  cause?: unknown,
): Promise<void> {
  const results = await Promise.allSettled([control.close(), harness.close()]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length === 0) return;
  throw new AggregateError(
    cause === undefined ? failures : [cause, ...failures],
    'failed to close all Ink fixture resources',
    cause === undefined ? undefined : { cause },
  );
}

function pairedRevisionObserver(
  harness: TerminalHarness,
  deadline: number,
): {
  waitFor(revision: number): Promise<void>;
  close(): void;
} {
  const seen = new Set<number>();
  const waiters = new Map<
    number,
    {
      readonly resolve: () => void;
      readonly reject: (error: Error) => void;
    }
  >();
  let exited: { readonly code: number | null; readonly signal: string | null } | null = null;
  const unsubscribes = [
    harness.events.on('semantic-revision', ({ revision }) => {
      seen.add(revision);
      waiters.get(revision)?.resolve();
    }),
    harness.events.on('exit', (status) => {
      exited = status;
      for (const [revision, waiter] of waiters) {
        waiter.reject(
          new ProcessExitedError(
            `the fixture exited (code ${String(status.code)}, signal ${String(status.signal)}) before semantic revision ${revision} was paired`,
            { semanticTree: true },
          ),
        );
      }
    }),
  ];
  let closed = false;
  return {
    async waitFor(revision) {
      if (seen.has(revision) || harness.checkpoint().semanticRevision === revision) return;
      if (exited !== null) {
        throw new ProcessExitedError(
          `the fixture exited (code ${String(exited.code)}, signal ${String(exited.signal)}) before semantic revision ${revision} was paired`,
          { semanticTree: true },
        );
      }
      const timeout = remainingRerenderTime(deadline, harness);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(revision);
          reject(
            new TimeoutError(
              `the fixture's semantic revision ${revision} was not paired within ${timeout} ms`,
              { semanticTree: true, screenExcerpt: harness.screen().text() },
            ),
          );
        }, timeout);
        timer.unref?.();
        waiters.set(revision, {
          resolve: () => {
            clearTimeout(timer);
            waiters.delete(revision);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            waiters.delete(revision);
            reject(error);
          },
        });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const waiter of waiters.values()) {
        waiter.reject(
          new SessionClosedError('the paired revision observer was closed', {
            semanticTree: harness.contract()?.capabilities['semantic-tree'].status === 'supported',
          }),
        );
      }
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}

function remainingRerenderTime(deadline: number, harness: TerminalHarness): number {
  const remaining = deadline - performance.now();
  if (remaining <= 0) {
    throw new TimeoutError('the fixture rerender exceeded its total timeout', {
      semanticTree: harness.contract()?.capabilities['semantic-tree'].status === 'supported',
      screenExcerpt: harness.screen().text(),
    });
  }
  return Math.ceil(remaining);
}

function moduleUrl(component: string | URL): string {
  if (component instanceof URL) return component.href;
  if (component.startsWith('file:')) return component;
  return pathToFileURL(component).href;
}
