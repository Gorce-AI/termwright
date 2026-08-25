/**
 * The byte-transparent stdout transport shared by OpenTUI's NativeSpanFeed and
 * Termwright commit markers. Both use this Writable's queue; neither can
 * overtake the other, and target failures become typed adapter violations.
 */

import { Writable } from 'node:stream';

export const MARKER_SINK_SYMBOL = Symbol.for('termwright.opentui.marker-sink.v1');
export const MARKER_SINK_TARGET_SYMBOL = Symbol.for('termwright.opentui.marker-sink-target.v1');
export const MARKER_SINK_FEED_WRITE_SYMBOL = Symbol.for('termwright.opentui.marker-sink-feed-write.v1');

export interface MarkerSink extends Writable {
  writeMarker(marker: string): void;
  readonly forwarded: number;
  readonly [MARKER_SINK_SYMBOL]: string;
  readonly [MARKER_SINK_TARGET_SYMBOL]: NodeJS.WriteStream;
  readonly [MARKER_SINK_FEED_WRITE_SYMBOL]: (chunk: Uint8Array, callback: () => void) => boolean;
  onFailure(handler: (error: Error) => void): () => void;
  releaseAfterUse(): void;
}

export function isMarkerSink(value: unknown, token: string): value is MarkerSink {
  return value !== null
    && typeof value === 'object'
    && (value as Partial<MarkerSink>)[MARKER_SINK_SYMBOL] === token;
}

interface LocalFeedRenderer {
  readonly stdout?: unknown;
  readonly _feed?: unknown;
  _usesProcessStdout?: unknown;
}

interface TargetFailureGuard {
  readonly subscribers: Set<(error: Error) => void>;
  readonly onError: (error: Error) => void;
  readonly onClose: () => void;
}

const targetFailureGuards = new WeakMap<object, TargetFailureGuard>();

function observeTargetFailures(target: NodeJS.WriteStream, subscriber: (error: Error) => void): () => void {
  let guard = targetFailureGuards.get(target);
  if (guard === undefined) {
    const subscribers = new Set<(error: Error) => void>();
    const onError = (error: Error): void => {
      for (const notify of [...subscribers]) notify(error);
    };
    const onClose = (): void => {
      const error = new Error('OpenTUI output target closed before renderer release');
      for (const notify of [...subscribers]) notify(error);
      target.off('error', onError);
      targetFailureGuards.delete(target);
      subscribers.clear();
    };
    guard = { subscribers, onError, onClose };
    targetFailureGuards.set(target, guard);
    target.on('error', onError);
    target.once('close', onClose);
  }
  guard.subscribers.add(subscriber);
  return () => {
    const current = targetFailureGuards.get(target);
    if (current === undefined) return;
    current.subscribers.delete(subscriber);
    if (current.subscribers.size !== 0) return;
    target.off('error', current.onError);
    target.off('close', current.onClose);
    targetFailureGuards.delete(target);
  };
}

/**
 * Restore the local-stdout lifecycle semantics that OpenTUI selects by object
 * identity, while retaining its NativeSpanFeed for causal/error-aware output.
 * This private runtime capability is exact-version and behavior certified.
 */
export function certifyLocalMarkerFeed(renderer: object, sink: MarkerSink, token: string): void {
  const candidate = renderer as LocalFeedRenderer;
  if (candidate.stdout !== sink[MARKER_SINK_TARGET_SYMBOL] || sink[MARKER_SINK_SYMBOL] !== token) {
    throw new Error('OpenTUI renderer did not retain the original stdout identity');
  }
  if (candidate._feed === null || typeof candidate._feed !== 'object') {
    throw new Error('OpenTUI renderer did not create the required native stdout feed');
  }
  if (candidate._usesProcessStdout !== true) {
    throw new Error('OpenTUI local stdout lifecycle capability is unavailable');
  }
}

export function createMarkerSink(target: NodeJS.WriteStream, token: string): MarkerSink {
  if (token.length === 0) throw new Error('OpenTUI marker sink token must not be empty');
  const targetWrite = target.write.bind(target) as (
    chunk: Uint8Array | string,
    encoding: BufferEncoding | undefined,
    callback: (error?: Error | null) => void,
  ) => boolean;
  let forwarded = 0;
  let markerBytes = 0;
  const failureHandlers = new Set<(error: Error) => void>();
  let firstFailure: Error | undefined;
  const notifyFailure = (error: Error): void => {
    if (firstFailure !== undefined) return;
    firstFailure = error;
    for (const handler of [...failureHandlers]) {
      try { handler(error); } catch { /* diagnostics cannot escape */ }
    }
  };
  const releaseTargetFailure = observeTargetFailures(target, notifyFailure);

  const sink = new Writable({
    write(chunk: Buffer | string, encoding, callback) {
      if (Buffer.isBuffer(chunk)) {
        forwarded += chunk.length;
        targetWrite(chunk, undefined, callback);
        return;
      }
      forwarded += Buffer.byteLength(chunk, encoding as BufferEncoding);
      targetWrite(chunk, encoding as BufferEncoding, callback);
    },
  }) as MarkerSink;

  // OpenTUI samples these on SIGWINCH. Copying the initial values would make
  // the instrumented renderer ignore later terminal resizes.
  Object.defineProperties(sink, {
    isTTY: { configurable: false, enumerable: false, get: () => target.isTTY === true },
    columns: { configurable: false, enumerable: false, get: () => target.columns ?? 80 },
    rows: { configurable: false, enumerable: false, get: () => target.rows ?? 24 },
  });
  Object.defineProperty(sink, MARKER_SINK_SYMBOL, { value: token });
  Object.defineProperty(sink, MARKER_SINK_TARGET_SYMBOL, { value: target });
  Object.defineProperty(sink, MARKER_SINK_FEED_WRITE_SYMBOL, {
    value: (chunk: Uint8Array, callback: () => void): boolean => sink.write(chunk, callback),
  });
  Object.defineProperty(sink, 'forwarded', { get: () => forwarded - markerBytes });
  sink.on('error', notifyFailure);
  sink.onFailure = (handler): (() => void) => {
    failureHandlers.add(handler);
    if (firstFailure !== undefined) {
      try { handler(firstFailure); } catch { /* diagnostics cannot escape */ }
    }
    return () => failureHandlers.delete(handler);
  };
  const releaseFailureObservation = (): void => {
    releaseTargetFailure();
    failureHandlers.clear();
  };
  sink.once('finish', releaseFailureObservation);
  // A failed Writable closes without `finish`. Defer one microtask so the
  // target can emit the error produced by the same write callback while the
  // shared guard is still attached, then release a sink that can no longer be
  // used. This is an event-order boundary, not an elapsed-time assumption.
  sink.once('close', () => queueMicrotask(releaseFailureObservation));
  sink.releaseAfterUse = (): void => {
    if (!sink.writableEnded) sink.end();
  };
  sink.writeMarker = (marker: string): void => {
    markerBytes += Buffer.byteLength(marker, 'utf8');
    sink.write(marker);
  };
  return sink;
}
