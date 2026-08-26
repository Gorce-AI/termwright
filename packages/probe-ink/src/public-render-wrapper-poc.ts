import { Stream } from 'node:stream';

export interface PublicRenderObserver {
  /** Runs before the application's callback for the same completed Ink render. */
  onRender(this: unknown, metrics: unknown): void;
  /** Observation failures cannot change application rendering. */
  onError?(error: unknown): void;
}

type RenderFunction = (this: unknown, ...args: unknown[]) => unknown;

/**
 * Internal spike for transparent composition around Ink's public `render()`.
 *
 * The React node, receiver, trailing arguments and returned instance retain
 * identity. The options object is copied because mutating an application-owned
 * (possibly frozen) object would be observable and cannot be safely restored
 * after Ink retains its callback.
 */
export function wrapPublicInkRender<T extends RenderFunction>(
  original: T,
  observer: PublicRenderObserver,
): T {
  return function (this: unknown, ...args: unknown[]): unknown {
    const supplied = args[1];
    const options = supplied instanceof Stream
      ? { stdout: supplied }
      : supplied === undefined
        ? {}
        : supplied as Record<PropertyKey, unknown>;
    // Clone exactly once. This matches Ink's own shallow-copy behavior for
    // getters and Proxy traps instead of observing application options twice.
    const forwardedOptions = { ...options };
    const userOnRender = forwardedOptions.onRender;
    const composed = function (this: unknown, metrics: unknown): unknown {
      try {
        Reflect.apply(observer.onRender, this, [metrics]);
      } catch (error) {
        try {
          observer.onError?.(error);
        } catch {
          // A diagnostic observer is no more entitled to break Ink than the
          // primary observer. Production fail-closed state belongs outside the
          // application's synchronous render callback.
        }
      }
      if (userOnRender === undefined || userOnRender === null) return undefined;
      return Reflect.apply(userOnRender as (...values: unknown[]) => unknown, this, [metrics]);
    };
    const forwarded = [...args];
    forwarded[1] = { ...forwardedOptions, onRender: composed };
    return Reflect.apply(original, this, forwarded);
  } as T;
}
