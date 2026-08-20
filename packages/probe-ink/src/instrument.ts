/** The render wrapper imported by the replacement Ink entry module. */

import { Stream } from 'node:stream';
import { createElement, Fragment, type ComponentType, type ReactNode } from 'react';
import type { DOMElement, Instance, RenderOptions } from 'ink';
import type { AdapterCapability } from '@termwright/protocol';
import { ENV_ENDPOINT, ENV_PROTOCOL, ENV_TOKEN, PROTOCOL_V2_ID } from '@termwright/protocol';
import { connectProbe, type ProbeChannel } from '@termwright/probe-runtime';
import { canPublishInkGeometry } from './geometry.js';
import type { InkDomElement, MeasureElement } from './observe.js';
import { createInkSession, probeInfo, type InkProbeSession } from './session.js';
import { isInstrumented } from './runtime.js';
import type { EnvSource } from './runtime.js';
import { PACKAGE_VERSION } from './version.js';
import { onInkAnnotationChange } from './annotations.js';

const ADAPTER_NAME = '@termwright/probe-ink';
const ADAPTER_VERSION = PACKAGE_VERSION;

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
      return instrumentedRender(ink, node, suppliedOptions, env);
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
): Instance {
  const options = normalizeOptions(suppliedOptions);
  const stdout = options.stdout ?? process.stdout;
  const probeRef: { current: DOMElement | null } = { current: null };
  const state: { channel: ProbeChannel | null; session: InkProbeSession | null } = {
    channel: null,
    session: null,
  };
  let disposed = false;
  const releaseAnnotations = onInkAnnotationChange(() => state.session?.notifyRender());

  const wrap = (child: ReactNode): ReactNode => createElement(
    Fragment,
    null,
    createElement(ink.Box, { ref: probeRef, display: 'none' }),
    child,
  );

  const userOnRender = options.onRender;
  const instance = ink.render(wrap(node), {
    ...options,
    onRender(metrics) {
      try {
        // Freeze the committed host tree before an application callback can
        // synchronously schedule or flush another update.
        state.session?.notifyRender();
      } catch {
        state.session?.stop();
      }
      userOnRender?.(metrics);
    },
  });

  const includeGeometry = canPublishInkGeometry({
    alternateScreen: options.alternateScreen === true,
    ...(options.interactive === undefined ? {} : { interactive: options.interactive }),
    stdoutIsTTY: stdout.isTTY === true,
  });
  const baseCapabilities: readonly AdapterCapability[] = includeGeometry
    ? ['tree', 'bounds', 'absolute-bounds', 'states', 'actions', 'render-revisions']
    : ['tree', 'states', 'actions', 'render-revisions'];
  const qualified = env[ENV_PROTOCOL] === PROTOCOL_V2_ID;
  const capabilities: readonly AdapterCapability[] = qualified
    ? [...baseCapabilities, 'qualified-observations']
    : baseCapabilities;

  const connection = connectProbe({
    endpoint: env[ENV_ENDPOINT] as string,
    token: env[ENV_TOKEN] as string,
    probe: probeInfo(),
    capabilities,
    adapterName: ADAPTER_NAME,
    adapterVersion: ADAPTER_VERSION,
    ...(qualified ? { protocol: PROTOCOL_V2_ID } : {}),
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
        measureElement: ink.measureElement,
        stdout,
        includeGeometry,
      });
      // The first commit may have beaten the handshake, but the live host tree
      // can already contain a throttled commit whose bytes are not on screen.
      // Flush Ink first. If that emits onRender, the newly-installed session
      // captures it there; otherwise the stable current tree is a safe catch-up.
      try {
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
    releaseAnnotations();
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

  return {
    ...instance,
    rerender(next) {
      instance.rerender(wrap(next));
    },
    unmount(error?: unknown) {
      return instance.unmount(error as Parameters<Instance['unmount']>[0]);
    },
    cleanup() {
      stop();
      instance.cleanup();
    },
  };
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
