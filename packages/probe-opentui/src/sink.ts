/**
 * The stdout the probe hands OpenTUI, and why it hands it one at all.
 *
 * OpenTUI writes frames from a Zig thread over FFI. Measured (see NOTES and
 * `bench/marker-route.ts`): with the application's real stdout, **zero bytes**
 * reach JS, so a render-commit marker cannot be placed after the frame it
 * commits. Passing a custom stdout makes OpenTUI allocate a NativeSpanFeed and
 * hand the bytes back — at no measurable cost — and from there the ordering is
 * ours to choose rather than to infer.
 *
 * The sink is a pass-through: everything it receives goes to the real stream,
 * unchanged and in order. The only thing it adds is the marker, and only after
 * a frame's bytes have gone out.
 */

import { Writable } from 'node:stream';

/** A stdout stand-in that forwards everything and can append a marker. */
export interface MarkerSink extends Writable {
  /**
   * Write a marker after the bytes already forwarded.
   *
   * Safe to call when no frame produced output: the marker still goes out, and
   * a receiver reads it as a commit of an unchanged screen.
   */
  writeMarker(marker: string): void;
  /**
   * Application bytes forwarded to the real stream, markers excluded, for
   * tests and diagnostics.
   */
  readonly forwarded: number;
  /** Observe a terminal stream failure without leaving an uncaught error event. */
  onFailure(handler: (error: Error) => void): () => void;
}

/**
 * Wrap a real output stream.
 *
 * @param target - Where the bytes actually go; normally `process.stdout`.
 */
export function createMarkerSink(target: NodeJS.WriteStream): MarkerSink {
  let forwarded = 0;
  let markerBytes = 0;

  const sink = new Writable({
    write(chunk: Buffer | string, encoding, callback) {
      // Forward the chunk itself, not a re-encoded copy of it. Decoding a
      // Buffer to a string and back mangles anything that is not valid UTF-8,
      // and an instrumented run has to produce the bytes an uninstrumented one
      // would — plus markers, and nothing else.
      if (Buffer.isBuffer(chunk)) {
        forwarded += chunk.length;
        target.write(chunk, callback);
        return;
      }
      forwarded += Buffer.byteLength(chunk, encoding as BufferEncoding);
      target.write(chunk, encoding as BufferEncoding, callback);
    },
  }) as MarkerSink & { isTTY: boolean; columns: number; rows: number };

  // OpenTUI reads these off the stream it was given; without them it cannot
  // size the screen and falls back to defaults that do not match the terminal.
  sink.isTTY = target.isTTY === true;
  sink.columns = target.columns ?? 80;
  sink.rows = target.rows ?? 24;

  Object.defineProperty(sink, 'forwarded', { get: () => forwarded - markerBytes });
  const failureHandlers = new Set<(error: Error) => void>();
  let firstFailure: Error | undefined;
  const notifyFailure = (error: Error): void => {
    if (firstFailure !== undefined) return;
    firstFailure = error;
    for (const handler of [...failureHandlers]) {
      try {
        handler(error);
      } catch {
        // A diagnostic consumer must not turn a contained stream failure into
        // an application-level uncaught exception.
      }
    }
  };
  // A Writable whose _write callback fails emits `error` on the target even
  // when the callback supplied to target.write receives the same error. The
  // sink owns this target for the rest of the renderer lifetime, so it must
  // consume that event and route it through the adapter's typed failure path.
  // Keeping the listener for the sink lifetime is intentional: stopping the
  // probe does not replace the stdout object already installed in OpenTUI.
  target.on('error', notifyFailure);
  sink.on('error', (error: Error) => {
    notifyFailure(error);
  });
  (sink as MarkerSink).onFailure = (handler): (() => void) => {
    failureHandlers.add(handler);
    if (firstFailure !== undefined) {
      try { handler(firstFailure); } catch { /* diagnostic consumers are contained */ }
    }
    return () => failureHandlers.delete(handler);
  };
  (sink as MarkerSink).writeMarker = (marker: string): void => {
    // Through the sink, not around it. Writing straight to the target jumps
    // the stream's own queue, and a marker that overtakes the frame it
    // commits is worse than no marker: the receiver pairs a tree with the
    // screen that came before it. Synchronous refusal propagates to the
    // session, which converts it into a typed adapter failure.
    markerBytes += Buffer.byteLength(marker, 'utf8');
    sink.write(marker);
  };

  return sink;
}
