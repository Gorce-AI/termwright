/** Exact shadow of bytes Ink and application code write to their terminal. */

import { createTerminal, type Terminal } from '@termwright/vt';

export interface TerminalPosition {
  readonly row: number;
  readonly column: number;
  readonly buffer: 'normal' | 'alternate';
}

export interface InkTerminalTracker {
  drain(): Promise<void>;
  position(): TerminalPosition;
  resize(columns: number, rows: number): void;
  stop(): void;
}

export function trackTerminal(
  stdout: NodeJS.WriteStream,
  stderr: NodeJS.WriteStream,
): InkTerminalTracker {
  const built = createTerminal({
    columns: positive(stdout.columns, 80),
    rows: positive(stdout.rows, 24),
    scrollback: 100_000,
  });
  const terminal = built.terminal;
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;
  const restorers: (() => void)[] = [];

  const observe = (chunk: unknown, encoding?: unknown): void => {
    if (stopped) return;
    const bytes = Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
      ? chunk
      : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding as BufferEncoding : 'utf8');
    // A real Unix PTY has ONLCR enabled for the child output stream by default.
    // Ink writes LF, while both the host terminal and Termwright's driver see
    // CRLF after the line discipline. Shadow those committed bytes, not the
    // pre-PTY JavaScript payload. Pipes are deliberately left byte-exact.
    const committed = stdout.isTTY ? withOnlcr(bytes) : bytes;
    queue = queue.then(() => writeTerminal(terminal, committed)).catch(() => undefined);
  };

  for (const stream of new Set([stdout, stderr])) restorers.push(intercept(stream, observe));
  const onResize = (): void => terminal.resize(positive(stdout.columns, terminal.cols), positive(stdout.rows, terminal.rows));
  stdout.on('resize', onResize);
  restorers.push(() => stdout.off('resize', onResize));

  return {
    drain: () => queue,
    position() {
      const buffer = terminal.buffer.active;
      return { row: buffer.cursorY, column: buffer.cursorX, buffer: buffer.type };
    },
    resize(columns, rows) {
      terminal.resize(columns, rows);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const restore of restorers.reverse()) restore();
      terminal.dispose();
    },
  };
}

function withOnlcr(bytes: Uint8Array): Uint8Array {
  let newlines = 0;
  for (const byte of bytes) if (byte === 0x0a) newlines += 1;
  if (newlines === 0) return bytes;
  const output = new Uint8Array(bytes.length + newlines);
  let index = 0;
  for (const byte of bytes) {
    if (byte === 0x0a) output[index++] = 0x0d;
    output[index++] = byte;
  }
  return output;
}

function intercept(
  stream: NodeJS.WriteStream,
  observe: (chunk: unknown, encoding?: unknown) => void,
): () => void {
  const target = stream as NodeJS.WriteStream & { write: (...args: unknown[]) => boolean };
  const original = target.write;
  const wrapped = function (this: NodeJS.WriteStream, ...args: unknown[]): boolean {
    observe(args[0], args[1]);
    return Reflect.apply(original, this, args) as boolean;
  };
  try {
    target.write = wrapped;
  } catch (error) {
    throw new Error('Ink terminal stream cannot be instrumented exactly', { cause: error });
  }
  return () => {
    if (target.write === wrapped) target.write = original;
  };
}

function writeTerminal(terminal: Terminal, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve) => terminal.write(bytes, resolve));
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback;
}
