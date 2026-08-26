/** The render wrapper imported by the replacement Ink entry module. */

import { Stream } from 'node:stream';
import { createElement, Fragment, type ComponentType, type ReactNode } from 'react';
import type { DOMElement, Instance, RenderOptions } from 'ink';
import type { AdapterCapability } from '@termwright/protocol';
import { ENV_ENDPOINT, ENV_TOKEN } from '@termwright/protocol';
import { connectProbe, type ProbeChannel } from '@termwright/probe-runtime';
import type { InkDomElement, MeasureElement } from './observe.js';
import { createInkSession, probeInfo, type InkProbeSession } from './session.js';
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
import { registerTerminalInputModeEvidenceProvider } from '@termwright/evidence-provider';
import { trackTerminal } from './terminal-tracker.js';
import { onInkAnnotationChange } from './annotations.js';
import { RenderBoundaryQueue } from './render-boundary.js';

/**
 * Shadowing starts when this module is evaluated, not when render() runs.
 *
 * Import evaluation precedes the importing module's body, so an application
 * that arms mouse or focus reporting at module scope — before it renders
 * anything — is still observed. Starting later would let the probe report
 * those modes as off while they were on, and "authoritatively off" is a worse
 * answer than none at all.
 *
 * Handing the observation to a render-time tracker instead was tried and does
 * not work: the shadow parses its bytes on a queue, so the modes are not
 * readable at the synchronous moment render() would collect them.
 */
const processTracker = trackTerminal(process.stdout, process.stderr);

const ADAPTER_NAME = '@termwright/probe-ink';
const ADAPTER_VERSION = PACKAGE_VERSION;

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

    try {
      return instrumentedRender(ink, node, suppliedOptions, env, options.certifiedHarness === true);
    } catch {
      // Setup failures are probe failures. The application still gets its
      // ordinary render rather than inheriting our exception.
      return ink.render(node, suppliedOptions);
    }
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
): Instance {
  // A modified or unsupported Ink artifact is never observed through a weaker
  // path. The driver sees no adapter and required semantics fail negotiation.
  const certifiedRuntime = instrumentationSentinel() !== undefined;
  if (!certifiedRuntime && !certifiedHarness) return ink.render(node, suppliedOptions);
  const options = normalizeOptions(suppliedOptions);
  let currentNode = node;
  let commitGeneration = 0;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const releaseCapture = installInkCaptureHook();
  // Reuse the shadow that has been running since import when render() writes
  // to the streams it already watches, which is the default and the only case
  // where earlier bytes exist to have been missed.
  const ownsTracker = stdout !== process.stdout || stderr !== process.stderr;
  const tracker = ownsTracker ? trackTerminal(stdout, stderr) : processTracker;
  // The shadow parsed the same bytes the application wrote, so the probe knows
  // which mouse and focus modes are on without asking the terminal. Publishing
  // that closes the gap where a terminal cannot report its own modes — every
  // ConPTY session — and pointer actions were refused there not because the
  // application had mouse tracking off but because nothing could say it was on.
  const inputModeEvidence = registerTerminalInputModeEvidenceProvider({
    id: `${ADAPTER_NAME}/terminal-input-modes`,
    version: ADAPTER_VERSION,
    method: 'native',
    family: 'input-mode',
    observe: () => ({ inputModes: tracker.inputModes() }),
  });
  const probeRef: { current: DOMElement | null } = { current: null };
  const state: { channel: ProbeChannel | null; session: InkProbeSession | null } = {
    channel: null,
    session: null,
  };
  let disposed = false;
  const renderBoundaries = new RenderBoundaryQueue();
  const releaseAnnotations = onInkAnnotationChange(() => {
    // React layout-effect cleanup/registration can run while Ink is still
    // committing the host mutation that triggered it. Publishing immediately
    // could combine the new host tree with the previous renderer capture.
    // The renderer's onRender runs before this macrotask; annotation-only
    // changes still get a deterministic catch-up publication afterwards.
    setImmediate(() => {
      if (!disposed) state.session?.notifyRender({ allowUnsettled: true });
    });
  });

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
  const instance = ink.render(wrap(node), {
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
  });

  const capabilities: readonly AdapterCapability[] = [
    'tree',
    'intended-geometry',
    'clipped-geometry',
    'states',
    'actions',
    'render-revisions',
  ];

  const connection = connectProbe({
    endpoint: env[ENV_ENDPOINT] as string,
    token: env[ENV_TOKEN] as string,
    probe: probeInfo(),
    capabilities,
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
        resolveRoot: () => (probeRef.current?.parentNode as InkDomElement | undefined) ?? null,
        resolveExcluded: () => probeRef.current as InkDomElement | null,
        resolveCapture: (root) => capturedInkFrame(root),
        waitForRenderFlush: () => instance.waitUntilRenderFlush(),
        stdout,
        tracker,
        onGuaranteeViolation: () => {
          state.session?.stop();
          state.channel?.close();
        },
      });
      // The first commit may have beaten the handshake, but the live host tree
      // can already contain a throttled commit whose bytes are not on screen.
      // Flush Ink first. If that emits onRender, the newly-installed session
      // captures it there; otherwise the stable current tree is a safe catch-up.
      try {
        // The first onRender can run before React assigns the hidden host ref.
        // Force one real commit after the session exists instead of fabricating
        // a catch-up frame from a tree that was never captured.
        instance.rerender(wrap(currentNode));
        await instance.waitUntilRenderFlush();
      } catch {
        state.session.stop();
        return;
      }
      if (!disposed && state.session.frames === 0) state.session.notifyRender();
    })
    .catch(() => undefined);

  const stop = (): void => {
    if (disposed) return;
    disposed = true;
    renderBoundaries.stop();
    releaseCapture();
    releaseAnnotations();
    inputModeEvidence.dispose();
    if (ownsTracker) tracker.stop();
    state.session?.stop();
    state.channel?.close();
  };

  // Natural `useApp().exit()` does not call our wrapped cleanup. Await the
  // attach attempt and the exact publication queue instead of guessing a
  // teardown delay; a slow stdout must not lose its final marker.
  void instance.waitUntilExit()
    .catch(() => undefined)
    .then(async () => {
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
