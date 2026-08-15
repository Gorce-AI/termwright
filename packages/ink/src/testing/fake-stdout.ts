/**
 * A `WriteStream` stand-in that records everything written, in order.
 *
 * Ordering is what the marker tests are about, so this records discrete chunks
 * rather than a concatenated string.
 */

import { Writable } from 'node:stream';

/** An in-memory stdout with the TTY surface Ink and the adapter read. */
export interface FakeStdout extends NodeJS.WriteStream {
  /** Every chunk written, in write order. */
  readonly chunks: readonly string[];
  /** All chunks concatenated. */
  readonly text: string;
}

/** Create a fake TTY stdout of the given size. */
export function createFakeStdout(columns = 80, rows = 24): FakeStdout {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      callback();
    },
  }) as unknown as FakeStdout & { isTTY: boolean; columns: number; rows: number };

  stream.isTTY = true;
  stream.columns = columns;
  stream.rows = rows;
  Object.defineProperty(stream, 'chunks', { get: () => chunks });
  Object.defineProperty(stream, 'text', { get: () => chunks.join('') });
  return stream;
}
