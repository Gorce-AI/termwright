/**
 * Public entry point: attach termwright semantics to an OpenTUI renderer.
 */

import type { AdapterCapability } from '@termwright/protocol';
import { openChannel } from './channel.js';
import { canPublishAbsoluteBounds } from './collect.js';
import { readAdapterEnv, type EnvSource } from './config.js';
import { SemanticPublisher } from './publisher.js';
import { SemanticRegistry } from './registry.js';
import type { RenderableLike, SemanticMeta } from './types.js';

const ADAPTER_NAME = '@termwright/opentui';
/** Keep in sync with `package.json`; the driver reports it in diagnostics. */
const ADAPTER_VERSION = '0.1.0';

/** OpenTUI's frame-committed event name (`CliRenderEvents.FRAME`). */
const FRAME_EVENT = 'frame';

const BASE_CAPABILITIES: readonly AdapterCapability[] = [
  'tree',
  'bounds',
  'states',
  'actions',
  'render-revisions',
];

/**
 * What the adapter needs from an OpenTUI `CliRenderer`.
 *
 * A real `CliRenderer` satisfies this; the narrow shape is what lets the
 * adapter be tested without the native library (see `types.ts`).
 */
export interface RendererLike {
  readonly root: RenderableLike;
  readonly width: number;
  readonly height: number;
  /** `'alternate-screen' | 'main-screen' | 'split-footer'`. */
  readonly screenMode: string;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** Adapter knobs. */
export interface SemanticOptions {
  /** Environment to read instrumentation variables from. Defaults to `process.env`. */
  readonly env?: EnvSource;
  /** Milliseconds allowed for connect + handshake before giving up. Default 1000. */
  readonly handshakeTimeoutMs?: number;
  /**
   * The stream the renderer draws into.
   *
   * Defaults to the renderer's own stream when it exposes one, otherwise to
   * `process.stdout`. Pass it explicitly whenever the renderer was built over
   * streams of your own — the marker has to land in the same stream as the
   * frame it commits, or the driver cannot pair the two.
   */
  readonly stdout?: NodeJS.WriteStream;
}

/** A live instrumentation session. */
export interface SemanticSession {
  /** Whether the process is instrumented at all. `false` means fully dormant. */
  readonly active: boolean;
  /**
   * Annotate a renderable for this session.
   *
   * @returns a disposer that removes the annotation.
   */
  describe(node: RenderableLike, meta: SemanticMeta): () => void;
  /** Detach from the renderer and close the channel. Idempotent. */
  dispose(): void;
}

/** The dormant session: every method is a no-op, nothing is retained. */
const DORMANT: SemanticSession = Object.freeze({
  active: false,
  describe: () => noop,
  dispose: noop,
});

function noop(): void {
  // Intentionally empty: the dormant path must allocate and do nothing.
}

/**
 * The registry of the session that is currently instrumented, so the free
 * function {@link describeRenderable} can find it.
 *
 * There is at most one: OpenTUI's renderer takes exclusive ownership of the
 * process's streams, so a second instrumented renderer in the same process is
 * not a configuration that can exist.
 */
let activeRegistry: SemanticRegistry | null = null;

/**
 * Attach termwright semantics to a renderer.
 *
 * Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in the environment this
 * does nothing at all: no socket, no listener, no tree, no marker, and
 * byte-identical output. Ship it in production unconditionally.
 *
 * With them, the adapter connects to the driver, publishes a semantic snapshot
 * after every committed frame, and emits the render-commit marker once that
 * frame has reached the terminal.
 *
 * Call it directly after creating the renderer and before building the tree,
 * so that {@link describeRenderable} has a session to write into.
 *
 * Viewport-absolute coordinates are claimed only under
 * `screenMode: 'alternate-screen'`, the one mode in which the renderer
 * provably owns the whole terminal.
 *
 * @example
 * ```ts
 * import { createCliRenderer } from '@opentui/core';
 * import { describeRenderable, instrumentRenderer } from '@termwright/opentui';
 *
 * const renderer = await createCliRenderer({ screenMode: 'alternate-screen' });
 * instrumentRenderer(renderer);
 *
 * const approve = new BoxRenderable(renderer, { id: 'approve' });
 * describeRenderable(approve, { role: 'button', name: 'Approve' });
 * ```
 */
export function instrumentRenderer(
  renderer: RendererLike,
  options: SemanticOptions = {},
): SemanticSession {
  const env = readAdapterEnv(options.env ?? process.env);
  if (env === null) return DORMANT;

  const registry = new SemanticRegistry();
  activeRegistry = registry;

  const stdout = options.stdout ?? rendererStdout(renderer) ?? process.stdout;
  const claimsAbsoluteBounds = canPublishAbsoluteBounds(renderer.screenMode);
  const capabilities: readonly AdapterCapability[] = claimsAbsoluteBounds
    ? [...BASE_CAPABILITIES, 'absolute-bounds']
    : BASE_CAPABILITIES;

  let publisher: SemanticPublisher | undefined;
  let disposed = false;

  const onFrame = (): void => {
    publisher?.notifyFrame();
  };
  renderer.on(FRAME_EVENT, onFrame);

  void openChannel(env, {
    adapterName: ADAPTER_NAME,
    adapterVersion: ADAPTER_VERSION,
    capabilities,
    ...(options.handshakeTimeoutMs === undefined
      ? {}
      : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
  })
    .then((channel) => {
      if (channel === null) return;
      if (disposed) {
        channel.close();
        return;
      }
      publisher = new SemanticPublisher({
        channel,
        registry,
        resolveRoot: () => renderer.root,
        viewport: () => ({ columns: renderer.width, rows: renderer.height }),
        stdout,
        token: env.token,
        claimsAbsoluteBounds,
      });
      // Frames committed before the handshake completed were never published;
      // publish the state that is on screen right now.
      publisher.notifyFrame();
    })
    .catch(() => undefined);

  return {
    active: true,
    describe: (node, meta) => registry.register(node, meta),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      renderer.off(FRAME_EVENT, onFrame);
      if (activeRegistry === registry) activeRegistry = null;
      publisher?.dispose();
    },
  };
}

/**
 * Annotate a renderable with semantics the driver can address.
 *
 * Outside a semantic session — which is every uninstrumented run — this is a
 * no-op: nothing is registered, nothing is retained, and the application
 * behaves exactly as it would without the call. Annotating therefore never
 * needs to be conditional.
 *
 * @param node - the renderable being described
 * @param meta - role, name, state, actions and test id; all optional
 * @returns a disposer that removes the annotation
 *
 * @example
 * ```ts
 * const approve = new BoxRenderable(renderer, { id: 'approve' });
 * describeRenderable(approve, { role: 'button', name: 'Approve', state: { focused: true } });
 * ```
 */
export function describeRenderable(node: RenderableLike, meta: SemanticMeta): () => void {
  return activeRegistry === null ? noop : activeRegistry.register(node, meta);
}

/**
 * The renderer's output stream.
 *
 * `CliRenderer.stdout` is `private` in OpenTUI's declarations but present at
 * runtime, and it is the only way to learn which stream a renderer built over
 * custom wires is drawing into. Reading it is a convenience with a documented
 * fallback: an application that hits the fallback and needs otherwise passes
 * `stdout` explicitly.
 */
function rendererStdout(renderer: RendererLike): NodeJS.WriteStream | undefined {
  const candidate = (renderer as { stdout?: unknown }).stdout;
  return isWritable(candidate) ? (candidate as NodeJS.WriteStream) : undefined;
}

function isWritable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { write?: unknown }).write === 'function'
  );
}
