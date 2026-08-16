/**
 * Public entry point: `ink.render` with semantics attached.
 */

import type { ReactNode, RefObject } from 'react';
import { render, type DOMElement, type Instance, type RenderOptions } from 'ink';
import type { AdapterCapability } from '@termwright/protocol';
import { openChannel } from './channel.js';
import { canPublishAbsoluteBounds } from './collect.js';
import { readAdapterEnv, type EnvSource } from './config.js';
import { captureConsole, startLogForwarder, type LogForwarder } from './logs.js';
import { SemanticProvider } from './provider.js';
import { SemanticPublisher } from './publisher.js';
import { SemanticRegistry } from './registry.js';

const ADAPTER_NAME = '@termwright/ink';
/** Keep in sync with `package.json`; the driver reports it in diagnostics. */
const ADAPTER_VERSION = '0.1.0';

const BASE_CAPABILITIES: readonly AdapterCapability[] = [
  'tree',
  'bounds',
  'states',
  'actions',
  'render-revisions',
  // The diagnostics channel is always a possible source, so this is always
  // announced under instrumentation; the driver decides whether to enable it.
  'logs',
];

/** Adapter-specific knobs. Everything else on the options object goes to Ink. */
export interface SemanticOptions {
  /** Environment to read instrumentation variables from. Defaults to `process.env`. */
  readonly env?: EnvSource;
  /** Milliseconds allowed for connect + handshake before giving up. Default 1000. */
  readonly handshakeTimeoutMs?: number;
  /**
   * Capture `console.error`/`warn`/`log`/`info`/`debug` as log records, tagged
   * `logger: 'console'`. Default `true` under instrumentation, never in a
   * dormant process. Turn it off if the application already routes console
   * output into its own logger and you would rather not see both.
   */
  readonly captureConsole?: boolean;
}

/** Ink's render options plus the adapter's own. */
export type SemanticRenderOptions = RenderOptions & {
  readonly semantics?: SemanticOptions;
};

/**
 * Render an Ink app with termwright semantics.
 *
 * Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in the environment this
 * is `ink.render` and nothing else: no socket, no provider, no tree, no marker,
 * and byte-identical output. Ship it in production unconditionally.
 *
 * With them, the adapter connects to the driver, publishes a semantic snapshot
 * after every committed frame, and emits the render-commit marker once that
 * frame has reached stdout.
 *
 * Pass `alternateScreen: true` when you want viewport-absolute coordinates:
 * that is the only configuration in which Ink's layout region provably starts
 * at the top-left of the terminal, and the adapter claims the
 * `absolute-bounds` capability accordingly.
 *
 * @returns Ink's own instance; `unmount()` additionally tears the session down.
 *
 * @example
 * ```tsx
 * import {semanticRender} from '@termwright/ink';
 *
 * const app = semanticRender(<App />, {alternateScreen: true});
 * await app.waitUntilExit();
 * ```
 */
export function semanticRender(node: ReactNode, options: SemanticRenderOptions = {}): Instance {
  return renderWith(render, node, options);
}

/** An Ink-compatible render function: `ink.render` or a wrapper around it. */
export type InkRenderFn = (node: ReactNode, options?: RenderOptions) => Instance;

function renderWith(
  renderFn: InkRenderFn,
  node: ReactNode,
  options: SemanticRenderOptions,
): Instance {
  const { semantics, ...inkOptions } = options;
  const env = readAdapterEnv(semantics?.env ?? process.env);
  if (env === null) return renderFn(node, inkOptions);

  const registry = new SemanticRegistry();
  const probeRef: RefObject<DOMElement | null> = { current: null };
  const userOnRender = inkOptions.onRender;
  let publisher: SemanticPublisher | undefined;
  let logForwarder: LogForwarder | undefined;
  let disposed = false;

  const wrap = (child: ReactNode): ReactNode => (
    <SemanticProvider registry={registry} probeRef={probeRef}>
      {child}
    </SemanticProvider>
  );

  const instance = renderFn(wrap(node), {
      ...inkOptions,
      onRender: (metrics) => {
        userOnRender?.(metrics);
        publisher?.notifyRender();
      },
    },
  );

  const stdout = inkOptions.stdout ?? process.stdout;
  const claimsAbsoluteBounds = canPublishAbsoluteBounds({
    alternateScreen: inkOptions.alternateScreen === true,
    interactive: resolveInteractive(inkOptions.interactive, stdout, semantics?.env ?? process.env),
  });

  const capabilities: readonly AdapterCapability[] = claimsAbsoluteBounds
    ? [...BASE_CAPABILITIES, 'absolute-bounds']
    : BASE_CAPABILITIES;

  void openChannel(env, {
    adapterName: ADAPTER_NAME,
    adapterVersion: ADAPTER_VERSION,
    capabilities,
    ...(semantics?.handshakeTimeoutMs === undefined
      ? {}
      : { handshakeTimeoutMs: semantics.handshakeTimeoutMs }),
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
        resolveRoot: () => probeRef.current?.parentNode ?? null,
        stdout,
        token: env.token,
        claimsAbsoluteBounds,
      });
      // Frames committed before the handshake completed were never published;
      // publish the state that is on screen right now.
      publisher.notifyRender();

      // Only after the driver enabled the channel: the protocol forbids `log`
      // messages otherwise, and the budget is enforced here rather than there.
      const budget = channel.session.logs;
      if (budget !== undefined) {
        logForwarder =
          startLogForwarder({
            channel,
            budget,
            limits: channel.session.limits,
            currentRevision: () => publisher?.revision ?? 0,
          }) ?? undefined;
      }
    })
    .catch(() => undefined);

  // Installed straight after the first render, so it wraps Ink's own patched
  // console rather than being wrapped by it. Publishing is free until the
  // forwarder subscribes, so pre-handshake output simply finds no listener.
  const restoreConsole =
    semantics?.captureConsole === false ? () => undefined : captureConsole();

  const dispose = (): void => {
    disposed = true;
    logForwarder?.dispose();
    publisher?.dispose();
    restoreConsole();
  };

  return {
    ...instance,
    // `rerender` replaces the whole root, so it has to re-apply the wrapper —
    // otherwise the second frame renders without the provider, the probe ref
    // detaches, and the session goes quiet without any visible error.
    rerender: (next: ReactNode) => {
      instance.rerender(wrap(next));
    },
    unmount: (error?: unknown) => {
      dispose();
      return instance.unmount(error as Parameters<Instance['unmount']>[0]);
    },
    cleanup: () => {
      dispose();
      instance.cleanup();
    },
  };
}

/**
 * Wrap a custom render function — an Ink `render` with defaults baked in, or a
 * test harness that mimics its signature — so that it gains semantics.
 *
 * @example
 * ```tsx
 * const renderApp = withSemantics(render);
 * renderApp(<App />, {alternateScreen: true});
 * ```
 */
export function withSemantics(
  renderFn: InkRenderFn,
): (node: ReactNode, options?: SemanticRenderOptions) => Instance {
  return (node, options = {}) => renderWith(renderFn, node, options);
}

/**
 * Ink's own interactivity detection, reproduced conservatively: when the caller
 * did not decide, the adapter only believes the session is interactive if
 * stdout is a TTY and no CI marker is set. Being wrong here would mean claiming
 * absolute coordinates for a non-interactive run, where Ink writes a single
 * frame at unmount and the alternate screen is ignored entirely.
 */
function resolveInteractive(
  declared: boolean | undefined,
  stdout: NodeJS.WriteStream,
  env: EnvSource,
): boolean {
  if (declared !== undefined) return declared;
  if (stdout.isTTY !== true) return false;
  const ci = env['CI'];
  return ci === undefined || ci === '' || ci === 'false' || ci === '0';
}
