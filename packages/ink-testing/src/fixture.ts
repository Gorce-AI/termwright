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
  type TerminalHarness,
  type TimeoutClasses,
} from '@termwright/driver';
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
  /** Arguments inserted before the runner, e.g. `['--import', 'tsx']`. */
  readonly nodeArgs?: readonly string[];
  /** Driver timeout classes, as in `launchTerminal`. */
  readonly timeouts?: TimeoutClasses;
  /** How long the fixture may take to commit its first frame. */
  readonly settleTimeout?: number;
}

/**
 * Ink's frame cap inside a fixture. Matches the mount so that a component
 * behaves the same in both modes.
 */
const FIXTURE_MAX_FPS = 1_000;

/** The runner lives next to `dist/`, one level below the package root. */
const RUNNER_ENTRY = new URL('../runner/runner-entry.mjs', import.meta.url);

/**
 * Starts a fixture process in a real pty and returns a harness over it.
 *
 * The fixture renders `component`'s export with `props` through the same
 * `semanticRender` a production app uses, in the alternate screen, so the
 * semantic tree it publishes matches what `mountInk` produces for the same
 * element.
 *
 * @example
 * ```ts
 * const harness = await launchInkFixture({
 *   component: new URL('./counter-app.mjs', import.meta.url),
 *   props: { label: 'Approve' },
 *   columns: 40,
 *   rows: 10,
 * });
 * await harness.getByRole('button', { name: 'Approve' }).click();
 * await harness.waitForText('pressed 1');
 * await harness.close();
 * ```
 */
export async function launchInkFixture(options: LaunchInkFixtureOptions): Promise<TerminalHarness> {
  const payload = encodeFixturePayload({
    v: 1,
    module: moduleUrl(options.component),
    exportName: options.exportName ?? 'default',
    props: options.props ?? {},
    maxFps: FIXTURE_MAX_FPS,
  });

  const harness = await launchTerminal({
    command: [process.execPath, ...(options.nodeArgs ?? []), fileURLToPath(RUNNER_ENTRY), payload],
    columns: options.columns ?? 80,
    rows: options.rows ?? 24,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
  });

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
    await harness.close();
    throw error;
  }
  return harness;
}

function moduleUrl(component: string | URL): string {
  if (component instanceof URL) return component.href;
  if (component.startsWith('file:')) return component;
  return pathToFileURL(component).href;
}
