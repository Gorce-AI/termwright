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

import { onRendererConfig, onRendererCreated } from './attach.js';
import { createMarkerSink, type MarkerSink } from './sink.js';
import { probeInfo, startSession, type ObservableRenderer, type ProbeSession } from './session.js';
import { connectProbe, type ProbeChannel } from '@termwright/probe-runtime';
import { isInstrumented, type EnvSource } from './runtime.js';
import type { AdapterCapability } from '@termwright/protocol';
import { DEFAULT_LIMITS, ENV_ENDPOINT, ENV_TOKEN } from '@termwright/protocol';
import { PACKAGE_VERSION } from './version.js';
import { instrumentationSentinel } from './instrumentation.js';

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
 * connection is deliberately deferred until the imported OpenTUI artifact has
 * passed the exact-version checksum and installed its instrumentation sentinel.
 * An unsupported or modified build keeps running without an adapter attachment;
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
  let sink: MarkerSink | undefined;
  let connecting: Promise<void> | undefined;
  let stopped = false;

  const connectCertified = (): void => {
    if (connecting !== undefined || stopped) return;
    const sentinel = instrumentationSentinel();
    if (sentinel === undefined) return;
    connecting = connectProbe({
      endpoint: env[ENV_ENDPOINT] as string,
      token: env[ENV_TOKEN] as string,
      probe: probeInfo(sentinel.frameworkVersion),
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
        else state.channel = channel;
      })
      .catch(() => undefined);
  };

  // The one chance to install a custom stdout. Without it OpenTUI writes frames
  // from a Zig thread and no byte reaches JS, so a marker has nothing to follow.
  const releaseConfig = onRendererConfig((config) => {
    connectCertified();
    if (config['stdout'] !== undefined) return undefined;
    sink = createMarkerSink(target);
    return { ...config, stdout: sink };
  });

  const releaseRenderer = onRendererCreated((renderer) => {
    if (instrumentationSentinel() === undefined) return;
    connectCertified();
    state.session = startSession({
      renderer: renderer as ObservableRenderer,
      publisher: {
        publish: (snapshot, metrics) => state.channel?.publish(snapshot, metrics),
      },
      ...(sink === undefined ? {} : { sink }),
      // Resolved per frame: the renderer can exist before the handshake does.
      sessionId: () => state.channel?.session.sessionId ?? 'pending',
      limits: () => state.channel?.session.limits ?? DEFAULT_LIMITS,
      onGuaranteeViolation: (error) => {
        state.channel?.fail('adapter-guarantee-violation', error.message);
        state.session?.stop();
        state.channel = null;
      },
    });
  });

  return {
    get channel() {
      return state.channel;
    },
    get session() {
      return state.session;
    },
    stop() {
      stopped = true;
      releaseConfig();
      releaseRenderer();
      state.session?.stop();
      state.channel?.close();
    },
  };
}
