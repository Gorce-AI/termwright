/**
 * `mountInk` — component testing for Ink, in this process, over a real
 * terminal model.
 */

import type { ComponentType, ReactNode } from 'react';
import { Box, measureElement, render, type Instance, type RenderOptions } from 'ink';
import { wrapInkRender } from '@termwright/probe-ink/internal/testing';
import {
  launchTerminal,
  SessionClosedError,
  type AppLogSource,
  type EnvMode,
  type TerminalHarness,
  type TimeoutClasses,
} from '@termwright/driver';
import { createInProcessBackend } from './backend.js';
import { ForwardingHarness } from './forwarding.js';
import { MountErrorBoundary } from './error-boundary.js';
import { commitFrame, waitForFirstFrame, type SettleOptions } from './settle.js';

/**
 * The Ink render options a mount may override.
 *
 * The rest are the harness's own and cannot be changed: `stdout` and `stdin`
 * are the wires to the session, `interactive` and `alternateScreen` establish
 * the probe's only defensible coordinate premise, and `onRender` belongs to
 * the injected probe.
 *
 * `debug` is absent on purpose: it makes Ink append every frame instead of
 * repainting, which turns the screen model into a transcript and breaks every
 * coordinate-based locator.
 */
export type MountInkRenderOptions = Pick<
  RenderOptions,
  | 'maxFps'
  | 'exitOnCtrlC'
  | 'patchConsole'
  | 'incrementalRendering'
  | 'concurrent'
  | 'isScreenReaderEnabled'
>;

/** Options for {@link mountInk}. */
export interface MountInkOptions {
  /** Terminal width in cells. Default 80. */
  readonly columns?: number;
  /** Terminal height in cells. Default 24. */
  readonly rows?: number;
  /**
   * Providers the component needs — a theme, a store, a router. Applied inside
   * the error boundary, so a wrapper that throws is reported like any other
   * render failure.
   */
  readonly wrapper?: ComponentType<{ readonly children: ReactNode }>;
  /** Extra variables for the in-process probe session, never written to `process.env`. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * How the session environment is built, as in `launchTerminal`. Default
   * `'replace'`.
   *
   * **What this can and cannot do in a mount.** It shapes the environment the
   * driver computes and hands to the internal probe. It cannot touch what the component reads from
   * `process.env`, because that object belongs to the test runner and a mount
   * deliberately never mutates it. `'replace'` therefore isolates the session,
   * not the process.
   *
   * Environment isolation of the application itself is a property only a
   * separate process can have — use `launchInkFixture` for that.
   */
  readonly envMode?: EnvMode;
  /**
   * Log files to follow for the lifetime of the mount, as in `launchTerminal`.
   *
   * Entries arrive on the session timeline as `app-log` events, interleaved
   * with input and renders, which is what makes "the component logged this
   * *after* that keystroke" answerable. `collectLogs` in `@termwright/test`
   * reads them straight off the harness.
   */
  readonly logs?: readonly AppLogSource[];
  /** Driver timeout classes, as in `launchTerminal`. */
  readonly timeouts?: TimeoutClasses;
  /** How long the initial mount and each `rerender` may take to commit. */
  readonly settleTimeout?: number;
  /** Ink render options this mount overrides. */
  readonly ink?: MountInkRenderOptions;
}

/**
 * A {@link TerminalHarness} over an in-process Ink application, plus the two
 * things only an in-process mount can offer.
 */
export interface InkHarness extends TerminalHarness {
  /**
   * Replaces the mounted element and resolves once the resulting frame has been
   * committed and published — the component-test equivalent of a prop update.
   *
   * The wrapper and the error boundary are re-applied, and the boundary is
   * reset, so a rerender can recover from a crash.
   */
  rerender(element: ReactNode, opts?: SettleOptions): Promise<void>;

  /**
   * The error a component threw during render, or `null`.
   *
   * Set by the error boundary `mountInk` installs around the tree. It survives
   * until the next {@link InkHarness.rerender}.
   */
  renderError(): Error | null;
}

/** The command reported for an in-process session; there is no executable. */
const MOUNT_COMMAND = '<mountInk>';

/**
 * Ink throttles frames to `maxFps`. Tests wait for revisions rather than for
 * time, so throttling only adds latency — and, with a 33 ms default gap, enough
 * of it to make `waitForStable`'s quiet window land between two frames of the
 * same update.
 */
const MOUNT_MAX_FPS = 1_000;

/**
 * Mounts an Ink element in this process and returns a harness over it.
 *
 * The component runs against a headless VT emulator fed by Ink's own output, so
 * everything the driver offers a real terminal applies here: `getByRole`,
 * viewport cells and `press()` as key bytes. No callback is ever invoked
 * directly on the component — asserting a prop spy *after* physical input is
 * the point. Ink currently leaves occlusion unknown, so semantic click is
 * deliberately refused; drive activation with the keyboard.
 *
 * The mount resolves once the first frame has been published, so locators work
 * immediately.
 *
 * @example
 * ```tsx
 * const onPress = vi.fn();
 * const harness = await mountInk(<Approve onPress={onPress} />, { columns: 40, rows: 10 });
 * await harness.press('Tab');
 * await harness.waitForStable();
 * await harness.press('Enter');
 * await harness.waitForText('approved');
 * await vi.waitFor(() => expect(onPress).toHaveBeenCalledOnce());
 * await harness.close();
 * ```
 */
export async function mountInk(element: ReactNode, options: MountInkOptions = {}): Promise<InkHarness> {
  const columns = options.columns ?? 80;
  const rows = options.rows ?? 24;
  const settle: SettleOptions | undefined =
    options.settleTimeout === undefined ? undefined : { timeout: options.settleTimeout };

  const state: MountState = { instance: null, error: null, generation: 0 };
  const tree = (node: ReactNode): ReactNode => wrapTree(node, state, options.wrapper);

  const backend = createInProcessBackend((io) => {
    const instrumentedRender = wrapInkRender({
      render,
      Box: Box as never,
      measureElement: measureElement as never,
    }, { env: io.env });
    const instance = instrumentedRender(tree(element), {
      stdout: io.stdout,
      stdin: io.stdin,
      // Interactive + alternate screen establish the probe's qualified
      // absolute-bounds premise. Occlusion remains unknown.
      interactive: true,
      alternateScreen: true,
      maxFps: MOUNT_MAX_FPS,
      // Patching the global console is a process-wide side effect; a mount
      // leaves no trace of itself outside its own wires.
      patchConsole: false,
      ...options.ink,
    });
    state.instance = instance;
    // Awaited exactly once and shared. `waitUntilExit()` registers a
    // `beforeExit` listener that Ink only removes from inside `unmount()`, so
    // calling it a second time — after the unmount — would leave a listener on
    // `process` for every mount a test file makes.
    const exited = instance.waitUntilExit().then(
      () => undefined,
      () => undefined,
    );
    return {
      stop: async () => {
        instance.unmount();
        // Settles after the unmount's stdout writes complete, so the session
        // sees the final frame — and the alternate screen being restored —
        // before it is told the application is gone.
        await exited;
      },
      exited,
    };
  });

  const session = await launchTerminal({
    command: [MOUNT_COMMAND],
    backend,
    columns,
    rows,
    // The component harness owns both ends: the mounted component's mode
    // requests reach our own backend rather than a platform PTY, so they are
    // observable by construction. Saying so pins the same branch on every OS —
    // without it a Windows run silently degrades to "mouse mode unknown", and
    // an assertion about refusing a click starts asserting the opposite.
    modesObservable: true,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.envMode === undefined ? {} : { envMode: options.envMode }),
    ...(options.logs === undefined ? {} : { logs: options.logs }),
    ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
  });

  try {
    await waitForFirstFrame(session, settle);
  } catch (error) {
    await session.close();
    throw error;
  }

  return new InkHarnessImpl(session, state, tree, settle);
}

interface MountState {
  instance: Instance | null;
  error: Error | null;
  generation: number;
}

function wrapTree(
  node: ReactNode,
  state: MountState,
  Wrapper: ComponentType<{ readonly children: ReactNode }> | undefined,
): ReactNode {
  const inner = Wrapper === undefined ? node : <Wrapper>{node}</Wrapper>;
  return (
    // A fresh key per generation gives every rerender a fresh boundary, so a
    // tree that crashed once can render again after the bug is fixed by props.
    <MountErrorBoundary
      key={state.generation}
      onError={(error) => {
        state.error = error;
      }}
    >
      {inner}
    </MountErrorBoundary>
  );
}

/**
 * The harness `mountInk` returns: the driver's session, forwarded verbatim,
 * plus `rerender` and `renderError`.
 *
 * Forwarding is explicit rather than proxied so that the public surface of an
 * in-process harness is provably the driver's own — if `TerminalHarness` grows
 * a member, this class stops compiling.
 */
class InkHarnessImpl extends ForwardingHarness implements InkHarness {
  readonly #state: MountState;
  readonly #tree: (node: ReactNode) => ReactNode;
  readonly #settle: SettleOptions | undefined;

  constructor(
    session: TerminalHarness,
    state: MountState,
    tree: (node: ReactNode) => ReactNode,
    settle: SettleOptions | undefined,
  ) {
    super(session);
    this.#state = state;
    this.#tree = tree;
    this.#settle = settle;
  }

  // --- mount-only surface ---------------------------------------------------

  async rerender(element: ReactNode, opts?: SettleOptions): Promise<void> {
    const instance = this.#state.instance;
    if (instance === null) {
      throw new SessionClosedError('the mount is gone; rerender() needs a live application', {
        semanticTree: false,
      });
    }
    this.#state.error = null;
    this.#state.generation += 1;
    await commitFrame(this.session, () => instance.rerender(this.#tree(element)), opts ?? this.#settle);
  }

  renderError(): Error | null {
    return this.#state.error;
  }

  // --- TerminalHarness: everything else is forwarded by the base class ------

  override async close(): Promise<void> {
    await super.close();
    this.#state.instance = null;
  }
}
