/**
 * What runs inside an instrumented application, start to finish.
 *
 * This is the whole of zero-config from the inside: the entry points install a
 * module hook, the hook shims `@opentui/core`, the shim calls back here with
 * the config and then the renderer, and from that moment the probe observes and
 * publishes. The application imported nothing and configured nothing.
 *
 * Everything is best-effort by construction. If the driver is unreachable, if a
 * getter moved, if the socket dies — the application keeps running exactly as
 * it would have, minus the semantics.
 */

import {
  onRendererConfig,
  onRendererCreationFailed,
  onRendererCreated,
  onOutputSinkCheck,
  type ObservedRuntimeCertification,
} from './attach.js';
import { certifyLocalMarkerFeed, createMarkerSink, isMarkerSink } from './sink.js';
import { probeInfo, startSession, type ObservableRenderer, type ProbeSession } from './session.js';
import { connectProbe, type ProbeChannel } from '@termwright/probe-runtime';
import { isInstrumented, type EnvSource } from './runtime.js';
import type { AdapterCapability } from '@termwright/protocol';
import { DEFAULT_LIMITS, ENV_ENDPOINT, ENV_TOKEN } from '@termwright/protocol';
import { PACKAGE_VERSION } from './version.js';
import { installRuntimeObserver, type RuntimeObserver } from './runtime-observer.js';
import { outputInstrumentationVersion } from './output-instrumentation.js';

const ADAPTER_NAME = '@termwright/probe-opentui';
const ADAPTER_VERSION = PACKAGE_VERSION;

/**
 * Adapter capabilities: what kinds of traffic this sender produces.
 *
 * Distinct from the probe's own capabilities, which describe what it can
 * *observe* and travel in `ProbeInfo` — two closed sets that are easy to
 * confuse, and the compiler is the only thing that catches it.
 */
const BASE_CAPABILITIES: readonly AdapterCapability[] = [
  'tree',
  'intended-geometry',
  'states',
  'focus-state',
  'actions',
  'render-revisions',
];

/** A probe that has attached itself to this process. */
export interface Bootstrap {
  readonly channel: ProbeChannel | null;
  readonly session: ProbeSession | null;
  stop(): void;
}

/** Settings, all injectable so the whole path can be driven from a test. */
export interface BootstrapOptions {
  readonly env?: EnvSource;
  readonly stdout?: NodeJS.WriteStream;
  readonly handshakeTimeoutMs?: number;
}

/**
 * Arm the probe.
 *
 * Returns immediately. The hooks are installed synchronously, but the driver
 * connection is deliberately deferred until the intercepted OpenTUI package
 * has passed exact-version certification and its renderer runtime capabilities.
 * An unsupported package version keeps running without an adapter attachment;
 * no weaker capability set is negotiated as a fallback.
 */
export function bootstrap(options: BootstrapOptions = {}): Bootstrap {
  const env = options.env ?? process.env;
  const state: { channel: ProbeChannel | null; session: ProbeSession | null } = {
    channel: null,
    session: null,
  };
  if (!isInstrumented(env)) return { ...state, stop: () => undefined };

  const target = options.stdout ?? process.stdout;
  const token = env[ENV_TOKEN] as string;
  let connecting: Promise<void> | undefined;
  let stopped = false;
  let guaranteeFailed = false;
  let guaranteeDetail: string | undefined;
  let runtimeObserver: RuntimeObserver | undefined;
  let observedRenderer: ObservableRenderer | undefined;
  let certification: ObservedRuntimeCertification | undefined;
  let releaseConfig = (): void => undefined;
  let releaseRenderer = (): void => undefined;
  let releaseRendererFailure = (): void => undefined;
  let releaseDestroy = (): void => undefined;
  const pendingSinks = new Set<ReturnType<typeof createMarkerSink>>();
  const ownedSinks = new WeakSet<ReturnType<typeof createMarkerSink>>();
  let releaseSinkCheck = (): void => undefined;

  const releaseTerminalHooksIfIdle = (): void => {
    if (pendingSinks.size !== 0 || (!stopped && !guaranteeFailed)) return;
    releaseRenderer();
    releaseRenderer = () => undefined;
    releaseRendererFailure();
    releaseRendererFailure = () => undefined;
    releaseSinkCheck();
    releaseSinkCheck = () => undefined;
  };

  const releaseRuntime = (): void => {
    releaseConfig();
    releaseConfig = () => undefined;
    releaseDestroy();
    releaseDestroy = () => undefined;
    runtimeObserver?.dispose();
    runtimeObserver = undefined;
    state.session?.stop();
    state.session = null;
    observedRenderer = undefined;
    releaseTerminalHooksIfIdle();
  };

  const abort = (error: Error): void => {
    if (guaranteeFailed) return;
    guaranteeFailed = true;
    guaranteeDetail = error.message;
    releaseRuntime();
    if (state.channel !== null) {
      state.channel.fail('adapter-guarantee-violation', error.message);
      state.channel = null;
    }
  };

  const connectCertified = (): void => {
    if (connecting !== undefined || stopped) return;
    if (certification === undefined || (!guaranteeFailed && runtimeObserver === undefined)) return;
    connecting = connectProbe({
      endpoint: env[ENV_ENDPOINT] as string,
      token: env[ENV_TOKEN] as string,
      probe: probeInfo(certification.version),
      capabilities: [...BASE_CAPABILITIES, 'clipped-geometry', 'pointer-hit-grid'],
      adapterName: ADAPTER_NAME,
      adapterVersion: ADAPTER_VERSION,
      ...(options.handshakeTimeoutMs === undefined
        ? {}
        : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    })
      .then((channel) => {
        if (channel === null) return;
        if (stopped) channel.close();
        else if (guaranteeFailed) {
          channel.fail(
            'adapter-guarantee-violation',
            guaranteeDetail ?? 'OpenTUI runtime guarantee failed',
          );
        } else {
          state.channel = channel;
          // A renderer may have painted its only requested frame while the
          // handshake was in flight. Ask for one fresh committed frame rather
          // than publishing a stale pending observation.
          try {
            (observedRenderer as ObservableRenderer & { requestRender(): void }).requestRender();
          } catch (error) {
            abort(
              new Error(
                `OpenTUI requestRender failed: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          }
        }
      })
      .catch(() => undefined);
  };

  // The one chance to install a custom stdout. Without it OpenTUI writes frames
  // from a Zig thread and no byte reaches JS, so a marker has nothing to follow.
  releaseSinkCheck = onOutputSinkCheck(
    (value) => isMarkerSink(value, token) && ownedSinks.has(value),
  );

  releaseConfig = onRendererConfig((config) => {
    if (outputInstrumentationVersion(token) === undefined) {
      return undefined;
    }
    if (config['stdout'] !== undefined) {
      return undefined;
    }
    if (config['bufferedOutput'] === 'memory') {
      return undefined;
    }
    const sink = createMarkerSink(target, token);
    ownedSinks.add(sink);
    pendingSinks.add(sink);
    return { ...config, stdout: sink };
  });

  releaseRendererFailure = onRendererCreationFailed((effectiveConfig) => {
    const configuredStdout = effectiveConfig['stdout'];
    if (isMarkerSink(configuredStdout, token) && ownedSinks.has(configuredStdout)) {
      pendingSinks.delete(configuredStdout);
      configuredStdout.releaseAfterUse();
    }
    releaseTerminalHooksIfIdle();
  });

  releaseRenderer = onRendererCreated((renderer, certified, effectiveConfig) => {
    const configuredStdout = effectiveConfig['stdout'];
    const configuredSink =
      isMarkerSink(configuredStdout, token) && ownedSinks.has(configuredStdout)
        ? configuredStdout
        : undefined;
    if (configuredSink !== undefined) pendingSinks.delete(configuredSink);
    if (configuredSink !== undefined) {
      const owner = renderer as {
        on?: (event: string, handler: () => void) => void;
        once?: (event: string, handler: () => void) => void;
      };
      // OpenTUI emits destroy before its final native-feed drains and close.
      // Deferring to the next microtask lets finalizeDestroy finish without
      // writing into an already-ended sink; no elapsed-time assumption exists.
      const releaseSink = (): void => queueMicrotask(() => configuredSink.releaseAfterUse());
      if (typeof owner.once === 'function') owner.once('destroy', releaseSink);
      else owner.on?.('destroy', releaseSink);
    }
    if (stopped || guaranteeFailed) {
      releaseTerminalHooksIfIdle();
      return;
    }
    if (observedRenderer !== undefined) {
      abort(new Error('multiple OpenTUI renderers are not certified in one process'));
      return;
    }
    observedRenderer = renderer as ObservableRenderer;
    certification = certified;
    if (outputInstrumentationVersion(token) !== certified.version) {
      abort(
        new Error('OpenTUI local stdout feed instrumentation does not match the certified runtime'),
      );
      connectCertified();
      return;
    }
    if (configuredSink === undefined) {
      const detail =
        effectiveConfig['bufferedOutput'] === 'memory'
          ? 'OpenTUI memory-buffered output has no causal terminal commit channel'
          : configuredStdout !== undefined
            ? 'OpenTUI renderer has an application-owned stdout; same-writer render markers cannot be certified'
            : 'OpenTUI renderer has no certified marker sink';
      abort(new Error(detail));
      connectCertified();
      return;
    }
    const sink = configuredSink;
    try {
      certifyLocalMarkerFeed(renderer, sink, token);
      runtimeObserver = installRuntimeObserver(observedRenderer, (error) => {
        abort(error);
      });
      const lifecycleRenderer = observedRenderer;
      const destroyListener = (): void => {
        if (stopped) return;
        stopped = true;
        releaseRuntime();
        state.channel?.close();
        state.channel = null;
      };
      lifecycleRenderer.on('destroy', destroyListener);
      releaseDestroy = () => {
        try {
          lifecycleRenderer.off('destroy', destroyListener);
        } catch {
          /* teardown must not break the application */
        }
      };
      const session = startSession({
        renderer: observedRenderer,
        publisher: {
          publish: (snapshot, metrics) => state.channel?.publish(snapshot, metrics),
        },
        sink,
        // Resolved per frame: the renderer can exist before the handshake does.
        sessionId: () => state.channel?.session.sessionId ?? 'pending',
        limits: () => state.channel?.session.limits ?? DEFAULT_LIMITS,
        authoritativeProvider: runtimeObserver.provider,
        onGuaranteeViolation: abort,
      });
      if (guaranteeFailed) session.stop();
      else state.session = session;
    } catch (error) {
      abort(error instanceof Error ? error : new Error(String(error)));
      connectCertified();
      return;
    }
    connectCertified();
  });

  return {
    get channel() {
      return state.channel;
    },
    get session() {
      return state.session;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      releaseRuntime();
      state.channel?.close();
      state.channel = null;
    },
  };
}
