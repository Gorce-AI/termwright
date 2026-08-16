/**
 * `mountInk` — component testing for Ink, in this process, over a real
 * terminal model.
 */

import type { ComponentType, ReactNode } from 'react';
import type { Instance, RenderOptions } from 'ink';
import { semanticRender } from '@termwright/ink';
import {
  launchTerminal,
  SessionClosedError,
  type CellSnapshot,
  type CrashReport,
  type EnvMode,
  type ExitStatus,
  type Locator,
  type RoleLocatorOptions,
  type ScreenSnapshot,
  type ScrollbackApi,
  type SelectionApi,
  type SessionCapabilities,
  type SessionDiagnostic,
  type SessionEvents,
  type TerminalHarness,
  type TextLocatorOptions,
  type TimeoutClasses,
  type WaitOptions,
} from '@termwright/driver';
import type { SemanticRole, SemanticSnapshot } from '@termwright/protocol';
import { createInProcessBackend } from './backend.js';
import { MountErrorBoundary } from './error-boundary.js';
import { commitFrame, waitForFirstFrame, type SettleOptions } from './settle.js';

/**
 * The Ink render options a mount may override.
 *
 * The rest are the harness's own and cannot be changed: `stdout` and `stdin`
 * are the wires to the session, `interactive` and `alternateScreen` are what
 * make Ink's coordinates viewport-absolute (and therefore clickable), and
 * `onRender` belongs to the adapter.
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
  /**
   * Extra environment variables for the *session*, merged into the environment
   * the driver hands the adapter.
   *
   * This is not `process.env`. A mount shares the runner's process and never
   * writes to the real environment, so the component under test does not
   * observe these through `process.env` — only the adapter does. Launch a
   * fixture when the component itself must read an environment variable.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * How the session environment is built, as in `launchTerminal`. Default
   * `'replace'`.
   *
   * **What this can and cannot do in a mount.** It shapes the environment the
   * driver computes and hands to the adapter, which is what decides whether an
   * instrumented component sees a variable through `semanticRender`'s
   * `semantics.env`. It cannot touch what the component reads from
   * `process.env`, because that object belongs to the test runner and a mount
   * deliberately never mutates it. `'replace'` therefore isolates the session,
   * not the process.
   *
   * Environment isolation of the application itself is a property only a
   * separate process can have — use `launchInkFixture` for that.
   */
  readonly envMode?: EnvMode;
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
 * viewport coordinates, `click()` as a mouse report on stdin, `press()` as key
 * bytes. No callback is ever invoked directly on the component — asserting a
 * prop spy *after* physical input is the point.
 *
 * The mount resolves once the first frame has been published, so locators work
 * immediately.
 *
 * @example
 * ```tsx
 * const onPress = vi.fn();
 * const harness = await mountInk(<Approve onPress={onPress} />, { columns: 40, rows: 10 });
 * await harness.getByRole('button', { name: 'Approve' }).click();
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
    const instance = semanticRender(tree(element), {
      stdout: io.stdout,
      stdin: io.stdin,
      // Interactive + alternate screen is what lets the adapter claim
      // `absolute-bounds`, which is what makes clicking by role possible.
      interactive: true,
      alternateScreen: true,
      maxFps: MOUNT_MAX_FPS,
      // Patching the global console is a process-wide side effect; a mount
      // leaves no trace of itself outside its own wires.
      patchConsole: false,
      ...options.ink,
      semantics: { env: io.env },
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
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.envMode === undefined ? {} : { envMode: options.envMode }),
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
class InkHarnessImpl implements InkHarness {
  readonly #session: TerminalHarness;
  readonly #state: MountState;
  readonly #tree: (node: ReactNode) => ReactNode;
  readonly #settle: SettleOptions | undefined;

  constructor(
    session: TerminalHarness,
    state: MountState,
    tree: (node: ReactNode) => ReactNode,
    settle: SettleOptions | undefined,
  ) {
    this.#session = session;
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
    await commitFrame(this.#session, () => instance.rerender(this.#tree(element)), opts ?? this.#settle);
  }

  renderError(): Error | null {
    return this.#state.error;
  }

  // --- TerminalHarness ------------------------------------------------------

  get sessionId(): string {
    return this.#session.sessionId;
  }

  get scrollback(): ScrollbackApi {
    return this.#session.scrollback;
  }

  get selection(): SelectionApi {
    return this.#session.selection;
  }

  get events(): SessionEvents {
    return this.#session.events;
  }

  get exit(): Promise<ExitStatus> {
    return this.#session.exit;
  }

  capabilities(): SessionCapabilities {
    return this.#session.capabilities();
  }

  screen(): ScreenSnapshot {
    return this.#session.screen();
  }

  semanticTree(): SemanticSnapshot | null {
    return this.#session.semanticTree();
  }

  cell(pos: { row: number; column: number }): CellSnapshot {
    return this.#session.cell(pos);
  }

  getByRole(role: SemanticRole, opts?: RoleLocatorOptions): Locator {
    return this.#session.getByRole(role, opts);
  }

  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return this.#session.getByLabel(text, opts);
  }

  getByText(text: string | RegExp, opts?: TextLocatorOptions): Locator {
    return this.#session.getByText(text, opts);
  }

  getByTestId(testId: string): Locator {
    return this.#session.getByTestId(testId);
  }

  locator(selector: string): Locator {
    return this.#session.locator(selector);
  }

  locatorForRef(ref: string): Locator {
    return this.#session.locatorForRef(ref);
  }

  press(keys: string): Promise<void> {
    return this.#session.press(keys);
  }

  type(text: string): Promise<void> {
    return this.#session.type(text);
  }

  paste(text: string): Promise<void> {
    return this.#session.paste(text);
  }

  write(bytes: Uint8Array | string): Promise<void> {
    return this.#session.write(bytes);
  }

  resize(size: { columns: number; rows: number }): Promise<void> {
    return this.#session.resize(size);
  }

  focus(): Promise<void> {
    return this.#session.focus();
  }

  blur(): Promise<void> {
    return this.#session.blur();
  }

  signal(sig: 'INT' | 'TERM' | 'KILL' | 'HUP'): Promise<void> {
    return this.#session.signal(sig);
  }

  waitForText(text: string | RegExp, opts?: WaitOptions): Promise<void> {
    return this.#session.waitForText(text, opts);
  }

  waitForRender(opts: { after: number } & WaitOptions): Promise<void> {
    return this.#session.waitForRender(opts);
  }

  waitForStable(opts?: { frames?: number } & WaitOptions): Promise<void> {
    return this.#session.waitForStable(opts);
  }

  waitForIdle(opts?: WaitOptions): Promise<void> {
    return this.#session.waitForIdle(opts);
  }

  waitForReady(opts?: WaitOptions): Promise<void> {
    return this.#session.waitForReady(opts);
  }

  waitForExit(opts?: WaitOptions): Promise<ExitStatus> {
    return this.#session.waitForExit(opts);
  }

  diagnostics(): readonly SessionDiagnostic[] {
    return this.#session.diagnostics();
  }

  crashReport(): CrashReport | null {
    return this.#session.crashReport();
  }

  title(): string {
    return this.#session.title();
  }

  waitForTitle(text: string | RegExp, opts?: WaitOptions): Promise<void> {
    return this.#session.waitForTitle(text, opts);
  }

  async close(): Promise<void> {
    await this.#session.close();
    this.#state.instance = null;
  }
}
