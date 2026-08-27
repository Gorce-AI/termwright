/** The render wrapper imported by the replacement Ink entry module. */

import { Stream } from 'node:stream';
import { createElement, Fragment, type ComponentType, type ReactNode } from 'react';
import type { DOMElement, Instance, RenderOptions } from 'ink';
import type { AdapterCapability } from '@termwright/protocol';
import { ENV_ENDPOINT, ENV_TOKEN } from '@termwright/protocol';
import { connectProbe, type ProbeChannel } from '@termwright/probe-runtime';
import type { InkDomElement, MeasureElement } from './observe.js';
import { createInkMarkerWriter, createInkSession, probeInfo, type InkProbeSession } from './session.js';
import { isInstrumented } from './runtime.js';
import type { EnvSource } from './runtime.js';
import { PACKAGE_VERSION } from './version.js';
import {
  captureInkLayout,
  capturedInkFrame,
  installInkCaptureHook,
  retainInkFrame,
} from './frame-capture.js';
import { instrumentationSentinel } from './instrumentation.js';
import { trackTerminal, type InkTerminalTracker } from './terminal-tracker.js';
import { onInkAnnotationChange } from './annotations.js';
import { RenderBoundaryQueue } from './render-boundary.js';
import {
  acquireReactCommitBridge,
  activateInkRendererObservation,
  type ReactCommitBridge,
  type InkReconcilerInstrumentation,
} from './react-commit-bridge.js';

/**
 * Shadowing starts when this module is evaluated, not when render() runs.
 *
 * Import evaluation precedes the importing module's body, so cursor movement,
 * alternate-buffer changes and positioning written before the first render are
 * included in the same terminal shadow used to place the captured Ink frame.
 * Starting at render() would lose that prefix and derive incorrect bounds.
 * Pointer and focus modes are intentionally not inferred here: fd/native and
 * descendant writes bypass this JavaScript stream wrapper, so such evidence
 * would not be authoritative for an opaque child.
 */
const processTracker = trackTerminal(process.stdout, process.stderr);

const ADAPTER_NAME = '@termwright/probe-ink';
const ADAPTER_VERSION = PACKAGE_VERSION;
const INK_CAPABILITIES: readonly AdapterCapability[] = [
  'tree',
  'intended-geometry',
  'clipped-geometry',
  'states',
  'actions',
  'render-revisions',
];

/** Private cross-package hook used by the shipped fixture runner. */
export const INK_FLUSH_NEXT_RENDER = Symbol.for('@termwright/probe-ink/flush-next-render');
const COMMIT_GENERATION_ATTRIBUTE = '__termwrightCommitGeneration';

type InkRender = (
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
) => Instance;

/** Runtime Ink surface forwarded by the shim, kept structural to avoid cycles. */
export interface InkModule {
  readonly render: InkRender;
  readonly Box: ComponentType<Record<string, unknown>>;
  readonly measureElement: MeasureElement;
}

/** @internal Used only by the in-process component harness. */
export interface InstrumentInkOptions {
  readonly env?: EnvSource;
  /** Exact pinned in-process harness; never enabled by the application shim. */
  readonly certifiedHarness?: boolean;
  /** Ink's existing React reconciler instrumentation seam. */
  readonly reconciler?: InkReconcilerInstrumentation;
  /** @internal Deterministic transport seam for setup-failure tests. */
  readonly connect?: typeof connectProbe;
}

/**
 * Wrap the original `ink.render` while preserving every other Ink export.
 * With no complete driver environment this function calls the original render
 * directly, without even creating the hidden ref used by an active session.
 */
export function wrapInkRender(ink: InkModule, options: InstrumentInkOptions = {}): InkRender {
  const env = options.env ?? process.env;
  const wrapped: InkRender = (node, suppliedOptions) => {
    if (!isInstrumented(env)) return ink.render(node, suppliedOptions);
    return instrumentedRender(
      ink,
      node,
      suppliedOptions,
      env,
      options.certifiedHarness === true,
      options.reconciler,
      options.connect ?? connectProbe,
    );
  };
  Object.defineProperty(wrapped, '__termwright__', { value: true });
  return wrapped;
}

function instrumentedRender(
  ink: InkModule,
  node: ReactNode,
  suppliedOptions: NodeJS.WriteStream | RenderOptions | undefined,
  env: EnvSource,
  certifiedHarness: boolean,
  reconciler: InkReconcilerInstrumentation | undefined,
  connector: typeof connectProbe,
): Instance {
  // A modified or unsupported Ink artifact is never observed through a weaker
  // path. The driver sees no adapter and required semantics fail negotiation.
  const certifiedRuntime = instrumentationSentinel() !== undefined;
  if (!certifiedRuntime && !certifiedHarness) return ink.render(node, suppliedOptions);
  let options: RenderOptions;
  try {
    options = normalizeOptions(suppliedOptions);
  } catch (error) {
    return renderAfterSetupFailure(ink, node, suppliedOptions, connector, env, error);
  }
  let currentNode = node;
  let commitGeneration = 0;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  // Reuse the shadow that has been running since import when render() writes
  // to the streams it already watches, which is the default and the only case
  // where earlier bytes exist to have been missed.
  const ownsTracker = stdout !== process.stdout || stderr !== process.stderr;
  let tracker: InkTerminalTracker = processTracker;
  const probeRef: { current: DOMElement | null } = { current: null };
  const state: { channel: ProbeChannel | null; session: InkProbeSession | null } = {
    channel: null,
    session: null,
  };
  let disposed = false;
  const renderBoundaries = new RenderBoundaryQueue();
  let reactRoot: InkDomElement | null = null;
  let reactBridge: ReactCommitBridge | undefined;
  let releaseCapture: (() => void) | undefined;
  let releaseReactBridge: (() => void) | undefined;
  let releaseReactBridgeHook: (() => void) | undefined;
  let releaseAnnotations: (() => void) | undefined;

  const stop = (): void => {
    if (disposed) return;
    disposed = true;
    renderBoundaries.stop();
    releaseCapture?.();
    releaseReactBridge?.();
    releaseReactBridgeHook?.();
    releaseAnnotations?.();
    if (ownsTracker) tracker.stop();
    state.session?.stop();
    state.channel?.close();
  };

  try {
    releaseCapture = installInkCaptureHook();
    tracker = ownsTracker ? trackTerminal(stdout, stderr) : processTracker;
    if (reconciler !== undefined) {
      const bridgeLease = acquireReactCommitBridge();
      reactBridge = bridgeLease.bridge;
      releaseReactBridgeHook = bridgeLease.release;
      // Ink's DEV constructor invokes this exact reconciler seam itself. A
      // direct call here would double-inject into an existing user hook.
      if (env['DEV'] !== 'true') {
        reactBridge = activateInkRendererObservation(reconciler);
      }
      releaseReactBridge = reactBridge.subscribe((event) => {
        // Several ink.render() roots can coexist. Correlate through the
        // sentinel host instead of treating the latest global commit as ours.
        if (event.type === 'commit' && probeRef.current?.parentNode === event.root) {
          reactRoot = event.root;
        }
      });
    }
    releaseAnnotations = onInkAnnotationChange(() => {
      // React layout-effect cleanup/registration can run while Ink is still
      // committing. The renderer's onRender precedes this deterministic
      // annotation-only catch-up publication.
      setImmediate(() => {
        if (!disposed) state.session?.notifyRender({ allowUnsettled: true });
      });
    });
  } catch (error) {
    stop();
    return renderAfterSetupFailure(ink, node, suppliedOptions, connector, env, error);
  }

  const wrap = (child: ReactNode): ReactNode => createElement(
    Fragment,
    null,
    createElement(ink.Box, {
      ref: probeRef,
      display: 'none',
      [COMMIT_GENERATION_ATTRIBUTE]: commitGeneration,
    }),
    child,
  );

  const userOnRender = options.onRender;
  let instrumentedNode: ReactNode;
  let instrumentedOptions: RenderOptions;
  try {
    instrumentedNode = wrap(node);
    instrumentedOptions = {
      ...options,
      onRender(metrics) {
        // Box forwards non-layout metadata through the host style object. The
        // hidden sentinel is excluded from semantic observation, but its host
        // commit still gives this callback a synchronous causal generation.
        const generation = (probeRef.current as InkDomElement | null)
          ?.style?.[COMMIT_GENERATION_ATTRIBUTE];
        const boundary = typeof generation === 'number'
          ? renderBoundaries.take(generation)
          : undefined;
        try {
          if (!certifiedRuntime) {
            const root = (probeRef.current?.parentNode as InkDomElement | undefined) ?? null;
            if (root !== null) {
              const measured = ink.measureElement(root);
              const staticNode = root.staticNode;
              const staticRows = staticNode === undefined ? 0 : ink.measureElement(staticNode).height;
              retainInkFrame(captureInkLayout(root, {
                output: '',
                outputHeight: measured.height,
                staticOutput: '\n'.repeat(staticRows),
              }, {
                interactive: options.interactive === true,
                alternateScreen: options.alternateScreen === true,
                debug: options.debug === true,
                stdoutIsTTY: stdout.isTTY === true,
                rows: stdout.rows ?? 24,
              }));
            }
          }
          // Freeze the committed host tree before an application callback can
          // synchronously schedule or flush another update.
          const publication = state.session?.notifyRender({ awaitPublication: boundary !== undefined });
          if (boundary !== undefined) {
            if (publication === undefined) {
              boundary.reject(new Error('Ink semantic session is not attached'));
            } else {
              void publication.then(
                (revision) => {
                  if (revision === null) boundary.reject(new Error('Ink render was not published'));
                  else boundary.resolve(revision);
                },
                (error) => boundary.reject(error instanceof Error ? error : new Error(String(error))),
              );
            }
          }
        } catch (error) {
          boundary?.reject(error instanceof Error ? error : new Error(String(error)));
          state.session?.stop();
        }
        userOnRender?.(metrics);
      },
    };
  } catch (error) {
    stop();
    return renderAfterSetupFailure(ink, node, suppliedOptions, connector, env, error);
  }
  let instance: Instance;
  try {
    instance = ink.render(instrumentedNode, instrumentedOptions);
  } catch (error) {
    // The application render is never retried. Preserve the exact thrown
    // object and release every probe resource acquired before the call.
    stop();
    throw error;
  }

  if (reconciler !== undefined && reactBridge?.hasInkRenderer() !== true) {
    const error = new Error(
      'Ink semantic probe unavailable: React renderer instrumentation did not register Ink.',
    );
    stop();
    reportSetupFailure(connector, env, error);
    return instance;
  }

  let connection: Promise<void>;
  try {
    connection = connector({
      endpoint: env[ENV_ENDPOINT] as string,
      token: env[ENV_TOKEN] as string,
      probe: probeInfo(),
      capabilities: INK_CAPABILITIES,
      adapterName: ADAPTER_NAME,
      adapterVersion: ADAPTER_VERSION,
    })
    .then(async (channel) => {
      if (channel === null || disposed) {
        channel?.close();
        return;
      }
      state.channel = channel;
      state.session = createInkSession({
        channel,
        // The React bridge observes the same committed Ink host root through
        // FiberRoot.containerInfo. Keep the hidden ref as the certified
        // control while differential conformance is still in progress.
        resolveRoot: () => reactRoot
          ?? (probeRef.current?.parentNode as InkDomElement | undefined)
          ?? null,
        resolveExcluded: () => probeRef.current as InkDomElement | null,
        resolveCapture: (root) => capturedInkFrame(root),
        waitForRenderFlush: () => instance.waitUntilRenderFlush(),
        stdout,
        writeMarker: createInkMarkerWriter(stdout, { certifiedHarness }),
        tracker,
        onGuaranteeViolation: (error) => {
          state.session?.stop();
          channel.fail('adapter-guarantee-violation', error.message);
          // `fail()` owns transport termination. Keep the guard explicit so a
          // future channel implementation cannot leave a failed producer
          // attached and silently downgrade semantic coverage.
          if (channel.isOpen) channel.close();
        },
      });
      // The first commit may have beaten the handshake, but the live host tree
      // can already contain a throttled commit whose bytes are not on screen.
      // Drain that work, then bind a fresh hidden-host generation to one real
      // rerender. A bare `rerender(); waitUntilRenderFlush()` is not causal:
      // Ink may satisfy the wait with the render that was already pending,
      // leaving the new commit without an onRender publication. That race was
      // observable on Windows under Node 22 as a negotiated adapter with no
      // authoritative first tree.
      try {
        await renderBoundaries.afterCurrentRender(
          () => instance.waitUntilRenderFlush(),
          (generation) => {
            commitGeneration = generation;
            instance.rerender(wrap(currentNode));
          },
        );
      } catch {
        state.session.stop();
        return;
      }
    })
      .catch(() => undefined);
  } catch (error) {
    stop();
    reportSetupFailure(connector, env, error);
    return instance;
  }

  // Natural `useApp().exit()` does not call our wrapped cleanup. Await the
  // attach attempt and the exact publication queue instead of guessing a
  // teardown delay; a slow stdout must not lose its final marker.
  void instance.waitUntilExit()
    .catch(() => undefined)
    .then(async () => {
      // An exited renderer cannot complete an armed commit. Reject its causal
      // boundary before awaiting the attach promise, otherwise teardown can
      // wait on a render which Ink can no longer produce.
      renderBoundaries.stop();
      await connection;
      await state.session?.flush();
      stop();
    })
    .catch(stop);

  const wrappedInstance: Instance & {
    [INK_FLUSH_NEXT_RENDER](mutate: () => void): Promise<number>;
  } = {
    ...instance,
    rerender(next) {
      currentNode = next;
      instance.rerender(wrap(next));
    },
    unmount(error?: unknown) {
      return instance.unmount(error as Parameters<Instance['unmount']>[0]);
    },
    cleanup() {
      stop();
      instance.cleanup();
    },
    [INK_FLUSH_NEXT_RENDER](mutate: () => void): Promise<number> {
      return renderBoundaries.afterCurrentRender(
        () => instance.waitUntilRenderFlush(),
        (generation) => {
          commitGeneration = generation;
          mutate();
        },
      );
    },
  };
  return wrappedInstance;
}

function normalizeOptions(
  supplied: NodeJS.WriteStream | RenderOptions | undefined,
): RenderOptions {
  if (supplied === undefined) return {};
  // Match Ink's own `getOptions` test exactly. A merely stream-shaped options
  // object must not gain different semantics only because the probe is active.
  if (supplied instanceof Stream) {
    return { stdout: supplied as NodeJS.WriteStream };
  }
  return supplied as RenderOptions;
}

function reportSetupFailure(
  connector: typeof connectProbe,
  env: EnvSource,
  failure: unknown,
): void {
  const error = failure instanceof Error ? failure : new Error(String(failure));
  try {
    void connector({
      endpoint: env[ENV_ENDPOINT] as string,
      token: env[ENV_TOKEN] as string,
      probe: probeInfo(),
      capabilities: INK_CAPABILITIES,
      adapterName: ADAPTER_NAME,
      adapterVersion: ADAPTER_VERSION,
    }).then((channel) => {
      if (channel === null) return;
      channel.fail('adapter-guarantee-violation', error.message);
      // ProbeChannel.fail owns termination. Keep this guard explicit so a
      // future transport cannot leave a failed semantic producer connected.
      if (channel.isOpen) channel.close();
    }).catch(() => undefined);
  } catch {
    // Diagnostics must never replace the application's own render result.
  }
}

function renderAfterSetupFailure(
  ink: InkModule,
  node: ReactNode,
  suppliedOptions: NodeJS.WriteStream | RenderOptions | undefined,
  connector: typeof connectProbe,
  env: EnvSource,
  setupFailure: unknown,
): Instance {
  try {
    const instance = ink.render(node, suppliedOptions);
    reportSetupFailure(connector, env, setupFailure);
    return instance;
  } catch (applicationError) {
    reportSetupFailure(connector, env, setupFailure);
    // Preserve the application's exact thrown object. The setup failure is
    // already reported through the typed adapter channel and never replaces it.
    throw applicationError;
  }
}
