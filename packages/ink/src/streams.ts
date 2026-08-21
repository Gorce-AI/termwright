/**
 * The two streams that stand in for a pseudo-terminal's ends when Ink runs
 * in-process.
 *
 * `mountInk` does not fake the terminal — it fakes only the *wires*. Everything
 * Ink writes here is fed byte-for-byte to the same headless VT emulator a real
 * PTY session uses, and everything the driver sends arrives on stdin as the
 * literal bytes a terminal would have delivered. Ink therefore has no way to
 * tell that it is not attached to a terminal, which is the whole point: a click
 * in a component test is a mouse report, not a callback.
 */

import { Readable, Writable } from 'node:stream';

const LF = 0x0a;
const CR = 0x0d;

/**
 * The output half of a pty's line discipline: `ONLCR`, on by default on every
 * platform's pseudo-terminal.
 *
 * A terminal application writes a bare `\n` between rows and relies on the
 * kernel to turn it into `\r\n`; without that, the second row starts under the
 * end of the first and the whole frame staircases down the screen. `mountInk`
 * replaces the pty, so it inherits the pty's obligations — this is the most
 * consequential of them, and the one whose absence looks like a bug in the
 * component rather than in the harness.
 *
 * The transform is exactly what the kernel does, including the case of a `\n`
 * that already follows a `\r`: `ONLCR` is unconditional, and a doubled carriage
 * return moves the cursor to column zero twice, which is no move at all.
 */
export function applyOnlcr(data: Uint8Array): Uint8Array {
  let newlines = 0;
  for (const byte of data) if (byte === LF) newlines += 1;
  if (newlines === 0) return data;

  const out = new Uint8Array(data.length + newlines);
  let offset = 0;
  for (const byte of data) {
    if (byte === LF) out[offset++] = CR;
    out[offset++] = byte;
  }
  return out;
}

/**
 * Ink's view of stdout: a TTY-shaped `Writable` that hands every chunk to the
 * session as bytes.
 */
export interface HarnessStdout extends NodeJS.WriteStream {
  /**
   * Applies a new terminal size and emits `resize`, exactly as Node does for a
   * real TTY when the window changes.
   */
  setSize(columns: number, rows: number): void;
}

/**
 * Ink's view of stdin: a TTY-shaped `Readable` that supports raw mode.
 *
 * The stream is never switched to flowing mode by this module. Ink reads it
 * with a `readable` listener plus `read()`, and attaching a `data` listener
 * from the outside would starve that loop — so input arrives through
 * {@link HarnessStdin.deliver} instead.
 */
export interface HarnessStdin extends NodeJS.ReadStream {
  /** Pushes bytes as if the terminal had received them from a keyboard or mouse. */
  deliver(data: Uint8Array): void;
  /** Signals end-of-input; Ink sees the stream close. */
  finish(): void;
}

/**
 * Creates the stdout end of the wire.
 *
 * @param columns - initial width in cells
 * @param rows - initial height in cells
 * @param onData - receives every chunk Ink writes, as bytes, in write order,
 * after the pty's `ONLCR` translation
 */
export function createHarnessStdout(
  columns: number,
  rows: number,
  onData: (data: Uint8Array) => void,
): HarnessStdout {
  const stream = new Writable({
    // Ink writes strings; keeping them undecoded here means one conversion
    // instead of two, and the VT is fed the same UTF-8 a real pty would carry.
    decodeStrings: true,
    write(chunk: Buffer, _encoding, callback) {
      // A zero-length write is Ink's flush probe: it must still invoke the
      // callback, but there is nothing to hand to the emulator.
      if (chunk.length > 0) onData(applyOnlcr(new Uint8Array(chunk)));
      callback();
    },
  }) as unknown as HarnessStdout & {
    isTTY: boolean;
    columns: number;
    rows: number;
    setSize(columns: number, rows: number): void;
  };

  stream.isTTY = true;
  stream.columns = columns;
  stream.rows = rows;
  stream.setSize = (nextColumns: number, nextRows: number): void => {
    stream.columns = nextColumns;
    stream.rows = nextRows;
    stream.emit('resize');
  };
  // Ink installs a `resize` listener per render and never removes more than it
  // adds, but a long-lived harness plus React strict-mode double effects can
  // still push past the default ten.
  stream.setMaxListeners(50);
  return stream;
}

/** Creates the stdin end of the wire. */
export function createHarnessStdin(): HarnessStdin {
  const stream = new Readable({
    read(): void {
      // Data is pushed by `deliver`; there is nothing to pull.
    },
  }) as unknown as HarnessStdin & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode(mode: boolean): HarnessStdin;
    ref(): HarnessStdin;
    unref(): HarnessStdin;
    deliver(data: Uint8Array): void;
    finish(): void;
  };

  let finished = false;

  stream.isTTY = true;
  stream.isRaw = false;
  stream.setRawMode = (mode: boolean) => {
    stream.isRaw = mode;
    return stream;
  };
  // Ink refs/unrefs stdin around raw mode to keep the event loop alive for a
  // real tty handle. This stream holds nothing open, so both are no-ops — but
  // they must exist, or enabling raw mode throws.
  stream.ref = () => stream;
  stream.unref = () => stream;
  stream.deliver = (data: Uint8Array): void => {
    if (finished) return;
    stream.push(Buffer.from(data));
  };
  stream.finish = (): void => {
    if (finished) return;
    finished = true;
    stream.push(null);
  };
  stream.setMaxListeners(50);
  return stream;
}
