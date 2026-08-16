/**
 * `mountOpenTui` — component testing for OpenTUI, in this process, over a real
 * terminal model.
 *
 * Nothing here is OpenTUI-specific machinery. The pseudo-terminal stand-in, the
 * `ONLCR` translation a real pty owes its writer, and the revision-driven
 * settle waits all come from `@termwright/ink-testing`, which exports them for
 * exactly this. What this file adds is the ~40 lines that know how to build an
 * OpenTUI renderer over those wires and instrument it.
 *
 * **This module is reachable only through `@termwright/opentui/testing`.** The
 * adapter's root entry stays free of `@termwright/driver`, so an application
 * that instruments itself in production does not pull a pty binary into its
 * bundle — see NOTES.md, "Why the mount lives on a subpath".
 */

import {
  launchTerminal,
  UnsupportedActionError,
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
import {
  commitFrame,
  createInProcessBackend,
  waitForFirstFrame,
  type SettleOptions,
} from '@termwright/ink-testing';
import type { SemanticRole, SemanticSnapshot } from '@termwright/protocol';
import type { CliRenderer, CliRendererConfig } from '@opentui/core';
import { instrumentRenderer, type SemanticSession } from './instrument.js';

/** The command reported for an in-process session; there is no executable. */
const MOUNT_COMMAND = '<mountOpenTui>';

/**
 * Builds the scene under test.
 *
 * Called once, with a renderer already wired to the harness and already
 * instrumented, so {@link describeRenderable} annotations register against the
 * live session. Add renderables to `renderer.root`; anything returned is
 * ignored, and an async builder is awaited before the mount resolves.
 */
export type OpenTuiScene = (renderer: CliRenderer) => void | Promise<void>;

/** OpenTUI renderer options a mount may override. */
export type MountOpenTuiRendererOptions = Pick<
  CliRendererConfig,
  'targetFps' | 'maxFps' | 'useMouse' | 'enableMouseMovement' | 'useThread' | 'gatherStats'
>;

/** Options for {@link mountOpenTui}. */
export interface MountOpenTuiOptions {
  /** Terminal width in cells. Default 80. */
  readonly columns?: number;
  /** Terminal height in cells. Default 24. */
  readonly rows?: number;
  /**
   * Extra environment variables for the *session*, merged into the environment
   * the driver hands the adapter.
   *
   * This is not `process.env`: a mount shares the runner's process and never
   * writes to the real environment, so the scene does not observe these through
   * `process.env` — only the adapter does.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** How the session environment is built, as in `launchTerminal`. Default `'replace'`. */
  readonly envMode?: EnvMode;
  /** Driver timeout classes, as in `launchTerminal`. */
  readonly timeouts?: TimeoutClasses;
  /** How long the initial mount and each `commit` may take. */
  readonly settleTimeout?: number;
  /** Renderer options this mount overrides. */
  readonly renderer?: MountOpenTuiRendererOptions;
}

/**
 * A {@link TerminalHarness} over an in-process OpenTUI application, plus the
 * two things only an in-process mount can offer.
 */
export interface OpenTuiHarness extends TerminalHarness {
  /**
   * The live renderer, so a test can mutate the scene it built.
   *
   * Reach for it inside {@link OpenTuiHarness.commit}; mutating outside one
   * leaves the test asserting against a frame that may not have been drawn yet.
   */
  readonly renderer: CliRenderer;

  /**
   * Run `mutate`, then resolve once the frame it caused has been drawn and
   * published — the component-test equivalent of a prop update.
   *
   * @example
   * ```ts
   * await harness.commit(() => { label.content = 'Saved'; });
   * await expect(harness.getByRole('status')).toHaveText('Saved');
   * ```
   */
  commit(mutate: () => void, opts?: SettleOptions): Promise<void>;
}

/** Whether this process is Bun, the only runtime OpenTUI's native library loads under. */
function isBun(): boolean {
  return typeof process.versions.bun === 'string';
}

/**
 * Mount an OpenTUI scene in this process and return a harness over it.
 *
 * The scene runs against a headless VT emulator fed by OpenTUI's own output, so
 * everything the driver offers a real terminal applies: `getByRole`, viewport
 * coordinates, `click()` as a mouse report on stdin, `press()` as key bytes. No
 * handler is ever invoked directly on a renderable — asserting a spy *after*
 * physical input is the point.
 *
 * **Requires Bun.** `@opentui/core` loads its native Zig library through
 * `bun:ffi`, and no released Node has an equivalent, so a mount under Node
 * fails immediately with an `unsupported-action` error rather than deep inside
 * OpenTUI's FFI shim. Run the suite with `bun`, or drive a real pty instead.
 *
 * @throws UnsupportedActionError when the process is not Bun.
 *
 * @example
 * ```ts
 * import { BoxRenderable, TextRenderable } from '@opentui/core';
 * import { describeRenderable } from '@termwright/opentui';
 * import { mountOpenTui } from '@termwright/opentui/testing';
 *
 * const harness = await mountOpenTui((renderer) => {
 *   const approve = new BoxRenderable(renderer, { id: 'approve', width: 11, height: 1 });
 *   approve.add(new TextRenderable(renderer, { content: '[ Approve ]' }));
 *   renderer.root.add(approve);
 *   describeRenderable(approve, { role: 'button', name: 'Approve' });
 * }, { columns: 40, rows: 8 });
 *
 * await harness.getByRole('button', { name: 'Approve' }).click();
 * await harness.close();
 * ```
 */
export async function mountOpenTui(
  scene: OpenTuiScene,
  options: MountOpenTuiOptions = {},
): Promise<OpenTuiHarness> {
  if (!isBun()) {
    throw new UnsupportedActionError(
      'mountOpenTui requires Bun: @opentui/core loads its native library through bun:ffi, ' +
        `and this process is Node ${process.versions.node}`,
      {
        semanticTree: false,
        suggestion:
          'run these tests under `bun`, or drive the application through a real pseudo-terminal ' +
          'with launchTerminal(), which works on any runtime',
      },
    );
  }

  // Imported here, not at module scope, so the Bun check above is what a Node
  // caller sees — rather than OpenTUI's own FFI failure at import time.
  const { CliRenderer } = await import('@opentui/core');

  const columns = options.columns ?? 80;
  const rows = options.rows ?? 24;
  const settle: SettleOptions | undefined =
    options.settleTimeout === undefined ? undefined : { timeout: options.settleTimeout };

  const state: MountState = { renderer: null, session: null, failure: null };

  const backend = createInProcessBackend((io) => {
    // Constructed rather than `createCliRenderer`-ed: the backend starts an
    // application synchronously, and the factory is async. The constructor is
    // public and does the wiring; `setupTerminal()` is the part that awaits,
    // and it runs below with the scene.
    const renderer = new CliRenderer(io.stdin, io.stdout, io.columns, io.rows, {
      screenMode: 'alternate-screen',
      exitOnCtrlC: false,
      // A mount leaves no trace of itself on the runner's process.
      exitSignals: [],
      consoleMode: 'disabled',
      useMouse: true,
      ...options.renderer,
    });
    state.renderer = renderer;

    let session: SemanticSession | undefined;
    const started = (async () => {
      await renderer.setupTerminal();
      // Instrumented before the scene is built, so `describeRenderable` calls
      // inside it find a live registry.
      session = instrumentRenderer(renderer, { env: io.env, stdout: io.stdout });
      await scene(renderer);
      renderer.requestRender();
    })().catch((error: unknown) => {
      state.failure = error instanceof Error ? error : new Error(String(error));
    });

    return {
      stop: async () => {
        await started;
        session?.dispose();
        renderer.destroy();
      },
      // The renderer runs until it is torn down; there is no self-exit to await.
      exited: new Promise<void>(() => undefined),
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
  state.session = session;

  try {
    await waitForFirstFrame(session, settle);
  } catch (error) {
    await session.close();
    // A scene that threw is the more useful failure: the settle timeout is only
    // its symptom.
    throw state.failure ?? error;
  }
  if (state.failure !== null) {
    await session.close();
    throw state.failure;
  }

  return new OpenTuiHarnessImpl(session, state.renderer as CliRenderer, settle);
}

interface MountState {
  renderer: CliRenderer | null;
  session: TerminalHarness | null;
  failure: Error | null;
}

/**
 * The harness `mountOpenTui` returns: the driver's session, forwarded verbatim,
 * plus `renderer` and `commit`.
 *
 * Forwarding is explicit rather than proxied so that the public surface of an
 * in-process harness is provably the driver's own — if `TerminalHarness` grows
 * a member, this class stops compiling.
 */
class OpenTuiHarnessImpl implements OpenTuiHarness {
  readonly #session: TerminalHarness;
  readonly #renderer: CliRenderer;
  readonly #settle: SettleOptions | undefined;

  constructor(session: TerminalHarness, renderer: CliRenderer, settle: SettleOptions | undefined) {
    this.#session = session;
    this.#renderer = renderer;
    this.#settle = settle;
  }

  // --- mount-only surface ---------------------------------------------------

  get renderer(): CliRenderer {
    return this.#renderer;
  }

  async commit(mutate: () => void, opts?: SettleOptions): Promise<void> {
    await commitFrame(
      this.#session,
      () => {
        mutate();
        // OpenTUI renders on demand; a mutation that does not itself request a
        // frame would otherwise never commit and the wait would time out.
        this.#renderer.requestRender();
      },
      opts ?? this.#settle,
    );
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

  settled(opts?: WaitOptions): Promise<SessionCapabilities> {
    return this.#session.settled(opts);
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

  close(): Promise<void> {
    return this.#session.close();
  }
}
