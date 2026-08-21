const PREFIX = '\u001b]133;';
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface TrackedShellCommand {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | null;
}

interface PendingCommand {
  readonly command: string;
  readonly maxOutputBytes: number;
  readonly resolve: (result: TrackedShellCommand) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  state: 'armed' | 'capturing';
  output: string;
}

/** Tracks exact command output between OSC 133 C and D markers. */
export class ShellCommandTracker {
  #buffer = '';
  #pending: PendingCommand | undefined;
  readonly #decoder = new TextDecoder();

  arm(command: string, timeout: number, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES): Promise<TrackedShellCommand> {
    if (this.#pending !== undefined) throw new Error('a shell command is already running');
    return new Promise<TrackedShellCommand>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending = undefined;
        reject(new Error(`the shell did not finish ${JSON.stringify(command)} within ${timeout} ms`));
      }, timeout);
      this.#pending = {
        command,
        maxOutputBytes,
        resolve,
        reject,
        timer,
        state: 'armed',
        output: '',
      };
    });
  }

  feed(data: Uint8Array): void {
    this.#buffer += this.#decoder.decode(data, { stream: true });
    for (;;) {
      const start = this.#buffer.indexOf(PREFIX);
      if (start < 0) {
        const keep = partialPrefixLength(this.#buffer);
        this.#consume(this.#buffer.slice(0, this.#buffer.length - keep));
        this.#buffer = this.#buffer.slice(this.#buffer.length - keep);
        return;
      }
      this.#consume(this.#buffer.slice(0, start));
      this.#buffer = this.#buffer.slice(start);
      const terminator = markerTerminator(this.#buffer);
      if (terminator === undefined) return;
      const payload = this.#buffer.slice(PREFIX.length, terminator.index);
      this.#buffer = this.#buffer.slice(terminator.index + terminator.length);
      this.#mark(payload);
    }
  }

  close(error = new Error('the shell session closed before the command completed')): void {
    const pending = this.#pending;
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.#pending = undefined;
    pending.reject(error);
  }

  #consume(text: string): void {
    const pending = this.#pending;
    if (pending?.state !== 'capturing' || text === '') return;
    pending.output += text;
    if (Buffer.byteLength(pending.output, 'utf8') <= pending.maxOutputBytes) return;
    clearTimeout(pending.timer);
    this.#pending = undefined;
    pending.reject(new Error(`shell command output exceeded ${pending.maxOutputBytes} bytes`));
  }

  #mark(payload: string): void {
    const [kind, argument] = payload.split(';', 2);
    const pending = this.#pending;
    if (pending === undefined) return;
    if (kind === 'C') {
      pending.state = 'capturing';
      pending.output = '';
      return;
    }
    if (kind !== 'D' || pending.state !== 'capturing') return;
    const parsed = argument === undefined ? Number.NaN : Number(argument);
    clearTimeout(pending.timer);
    this.#pending = undefined;
    pending.resolve({
      command: pending.command,
      output: pending.output,
      exitCode: Number.isInteger(parsed) ? parsed : null,
    });
  }
}

function markerTerminator(value: string): { readonly index: number; readonly length: number } | undefined {
  const bel = value.indexOf('\u0007', PREFIX.length);
  const st = value.indexOf('\u001b\\', PREFIX.length);
  if (bel < 0 && st < 0) return undefined;
  if (bel >= 0 && (st < 0 || bel < st)) return { index: bel, length: 1 };
  return { index: st, length: 2 };
}

function partialPrefixLength(value: string): number {
  const max = Math.min(value.length, PREFIX.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (PREFIX.startsWith(value.slice(-length))) return length;
  }
  return 0;
}
