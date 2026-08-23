/** Exact shadow of bytes Ink and application code write to their terminal. */

import { createTerminal, type Terminal } from '@termwright/vt';

export interface TerminalPosition {
  readonly row: number;
  readonly column: number;
  readonly buffer: 'normal' | 'alternate';
}

/**
 * The mouse and focus reporting the application has actually switched on.
 *
 * Read off the shadow terminal, which parsed the very bytes the application
 * wrote. That makes it an instrumented observation rather than a claim: it is
 * true even where the driver's own terminal cannot see these modes, which is
 * every ConPTY session.
 */
export interface InkTerminalInputModes {
  readonly mouseTracking: 'none' | 'x10' | 'vt200' | 'drag' | 'any';
  readonly mouseEncoding: 'default' | 'utf8' | 'sgr' | 'urxvt';
  readonly focusReporting: 'on' | 'off';
}

export interface InkTerminalTracker {
  drain(): Promise<void>;
  position(): TerminalPosition;
  inputModes(): InkTerminalInputModes;
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
  // xterm tracks the tracking mode and focus reporting but not which mouse
  // encoding is active, so that one is followed here from the same sequences.
  let mouseEncoding: InkTerminalInputModes['mouseEncoding'] = 'default';
  const setEncoding = (encoding: Exclude<InkTerminalInputModes['mouseEncoding'], 'default'>, enabled: boolean): void => {
    if (enabled) mouseEncoding = encoding;
    else if (mouseEncoding === encoding) mouseEncoding = 'default';
  };
  const privateModes = (params: (number | number[])[], enabled: boolean): boolean => {
    for (const param of params) {
      const code = Array.isArray(param) ? param[0] : param;
      if (code === 1005) setEncoding('utf8', enabled);
      else if (code === 1006) setEncoding('sgr', enabled);
      else if (code === 1015) setEncoding('urxvt', enabled);
    }
    // Never exclusive: xterm still applies the modes it knows about.
    return false;
  };
  terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (p) => privateModes(p, true));
  terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (p) => privateModes(p, false));

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
    inputModes() {
      const modes = terminal.modes;
      return Object.freeze({
        mouseTracking: modes.mouseTrackingMode,
        mouseEncoding,
        focusReporting: modes.sendFocusMode ? ('on' as const) : ('off' as const),
      });
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
