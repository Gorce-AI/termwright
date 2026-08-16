/**
 * Closing a socket without losing what was just written.
 *
 * `socket.destroy()` tears the socket down immediately and discards anything
 * still queued, so the common shape `socket.write(frame); socket.destroy();`
 * delivers the frame only when it happened to flush in the same tick. For a
 * refusal that is the worst possible failure: the driver records that it told
 * the adapter why, the adapter receives nothing, and the author debugging the
 * refusal is left without the one message that explains it.
 *
 * @internal
 */
import type { Socket } from 'node:net';

/** How long a peer is given to drain the farewell before the socket is torn down. */
export const CLOSE_FLUSH_MS = 1_000;

/**
 * Writes a final payload and closes the socket once it has been flushed.
 *
 * `end()` queues the payload and sends FIN behind it, so a reading peer always
 * receives it. The timer bounds the wait: a peer that never drains cannot hold
 * the socket — or the session — open.
 */
export function endAfterFlush(socket: Socket, payload: Uint8Array, graceMs = CLOSE_FLUSH_MS): void {
  if (socket.destroyed) return;
  const timer = setTimeout(() => socket.destroy(), graceMs);
  timer.unref?.();
  socket.once('close', () => clearTimeout(timer));
  // A peer that vanished mid-write is not an error worth reporting: the
  // connection is being closed anyway.
  socket.once('error', () => {
    clearTimeout(timer);
    socket.destroy();
  });
  socket.end(payload);
}
