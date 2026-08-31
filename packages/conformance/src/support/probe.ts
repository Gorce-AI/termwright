/**
 * A minimal driver, built for one job: watching what an adapter actually puts
 * on the wire.
 *
 * `@termwright/driver` deliberately hides frame ordering behind a settled tree,
 * which is the right API for tests of applications and the wrong one for tests
 * of adapters. The probe therefore speaks the protocol itself — endpoint,
 * handshake, framing, marker verification — and records every message together
 * with how many stdout bytes had been written when it arrived. That is what
 * makes the §4.3 ordering contract (snapshot → commit → marker-after-frame)
 * observable at all.
 *
 * It does emulate a terminal, because it has to: an adapter is free to draw by
 * positioning each run of cells (tview does), so the text a user sees exists
 * only on a rendered grid and never as contiguous bytes on the wire. Waiting
 * for text therefore reads the grid, while marker offsets read the byte stream.
 *
 * It is still not a second driver: it never locates and never acts.
 */
import { type Server, type Socket } from 'node:net';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  DEFAULT_LIMITS,
  ENV_ENDPOINT,
  ENV_TOKEN,
  MARKER_OSC_CODE,
  MARKER_OSC_PREFIX,
  parseAdapterMessage,
  PROTOCOL_ID,
  createFrameDecoder,
  encodeFrame,
  generateToken,
  verifyMarkerPayload,
  type AdapterToDriverMessage,
  type HelloAckMessage,
  type LogRecord,
} from '@termwright/protocol';
import type { Terminal } from '@xterm/headless';
import { createNativePtyBackend, VtScreen, type PtyProcess } from '@termwright/driver/experimental';
import { environment } from './pty.js';
import { ProbePeerOwner } from './probe-peer-owner.js';
import { ProbeProcessShutdown } from './probe-process-shutdown.js';
import { ProbeStartupTransaction } from './probe-startup.js';

/** How a fixture is started. Everything else about it is opaque to the probe. */
export interface AdapterCommand {
  readonly command: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

/** One message the adapter sent, stamped with the stdout position at arrival. */
export interface RecordedMessage {
  readonly message: AdapterToDriverMessage;
  /** Bytes of stdout the probe had received when this frame was parsed. */
  readonly stdoutBytes: number;
  readonly atMs: number;
}

/** One verified render marker found in stdout. */
export interface RecordedMarker {
  readonly revision: number;
  /** Offset of the marker's first byte in the stdout stream. */
  readonly offset: number;
  readonly atMs: number;
}

/** Log budget the probe grants to an adapter that announces `logs`. */
const LOG_BUDGET = Object.freeze({ enabled: true, maxRecordsPerSecond: 200, burst: 400 });

/** A frame the probe refused; a conforming adapter produces none. */
export interface RecordedFault {
  readonly code: string;
  readonly detail: string;
}

export interface ProbeOptions {
  readonly columns?: number;
  readonly rows?: number;
  /** Set `false` to withhold the instrumentation env — the dormant-run case. */
  readonly instrument?: boolean;
}

/** Everything the probe observed, readable while the child is still running. */
export interface ProbeObservation {
  readonly messages: readonly RecordedMessage[];
  readonly markers: readonly RecordedMarker[];
  readonly faults: readonly RecordedFault[];
  readonly connections: number;
  readonly stdout: Uint8Array;
  /** Raw bytes decoded as UTF-8: what was written, in order, escapes included. */
  readonly text: string;
  /** The visible grid, one row per line — what a user would actually see. */
  readonly screen: string;
  /** Application log records the adapter sent, in arrival order. */
  readonly logs: readonly LogRecord[];
}

/**
 * A marker on the wire: `OSC 8487 ; twm;<rev>;<mac>` closed by BEL or ST.
 *
 * Both terminators are matched because both are legal — an implementation
 * emits BEL, but a receiver that only understood BEL would reject a
 * conforming adapter, and this probe stands in for a receiver.
 */
const MARKER_PATTERN = new RegExp(
  `\\x1b\\]${MARKER_OSC_CODE};(${MARKER_OSC_PREFIX}[0-9]+;[A-Za-z0-9_-]+)(?:\\x07|\\x1b\\\\)`,
  'gu',
);

/**
 * Runs one fixture under a pseudo-terminal with a protocol endpoint attached.
 *
 * @example
 * ```ts
 * const probe = await AdapterProbe.start({ command: ['node', 'app.mjs'] }, {});
 * await probe.waitForText('Ready');
 * await probe.write('\t');
 * const { messages, markers } = probe.observe();
 * await probe.stop();
 * ```
 */
export class AdapterProbe {
  readonly sessionId: string;
  readonly token: string;

  readonly #server: Server | null;
  readonly #directory: string | null;
  readonly #pty: PtyProcess;
  readonly #vt: VtScreen;
  readonly #terminal: Terminal;
  #detachTerminalResponse: (() => void) | null;
  readonly #startedAt = performance.now();
  readonly #messages: RecordedMessage[] = [];
  readonly #markers: RecordedMarker[] = [];
  readonly #faults: RecordedFault[] = [];
  readonly #logs: LogRecord[] = [];
  #chunks: Uint8Array[] = [];
  #bytes = 0;
  #text = '';
  #markerScanFrom = 0;
  #connections = 0;
  #socket: Socket | null = null;
  readonly #peers: ProbePeerOwner;
  #exit: { code: number | null; signal: string | null } | null = null;
  /** Where the adapter writes its own account of attaching, if it writes one. */
  #debugFile: string | null = null;
  readonly #shutdown: ProbeProcessShutdown;
  readonly #changeWaiters = new Set<() => void>();

  private constructor(
    identity: { readonly sessionId: string; readonly token: string },
    server: Server | null,
    directory: string | null,
    pty: PtyProcess,
    size: { readonly columns: number; readonly rows: number },
    peers: ProbePeerOwner,
  ) {
    this.sessionId = identity.sessionId;
    this.token = identity.token;
    this.#server = server;
    this.#directory = directory;
    this.#pty = pty;
    this.#peers = peers;
    this.#vt = new VtScreen({
      columns: size.columns,
      rows: size.rows,
      scrollbackLines: 1_000,
    });
    this.#terminal = this.#vt.terminal;
    // This probe is the terminal emulator, so it owns terminal-generated
    // replies just like TerminalSession does. Without this bridge the pinned
    // Windows host can block a framework's GCSBI on its private cursor query,
    // leaving the first frame visible while every later draw waits forever.
    this.#detachTerminalResponse = this.#vt.onResponse((response) =>
      this.#writeTerminalResponse(response.data),
    );
    this.#shutdown = new ProbeProcessShutdown({
      pty,
      closeAdmission: () =>
        this.#server === null ? Promise.resolve() : this.#peers.close(this.#server),
      closeTerminalResponseAdmission: () => this.#closeTerminalResponseAdmission(),
      drainParser: () => this.#vt.drain(),
      disposeParser: () => {
        this.#notifyChange();
        this.#vt.dispose();
      },
      removeArtifacts: () => this.#removeArtifacts(),
    });
  }

  /** Creates the endpoint (unless dormant), then spawns the fixture. */
  static async start(command: AdapterCommand, options: ProbeOptions = {}): Promise<AdapterProbe> {
    const instrument = options.instrument ?? true;
    const sessionId = randomUUID();
    const token = generateToken();
    const startup = new ProbeStartupTransaction();
    try {
      await startup.acquireEndpoint(instrument);
      const { server, directory, endpoint, peers } = startup;
      const env = environment(command.env);
      // A dormant run must not merely lack our endpoint — it must not inherit one
      // from whatever process is running the suite.
      delete env[ENV_ENDPOINT];
      delete env[ENV_TOKEN];
      if (endpoint !== null) {
        env[ENV_ENDPOINT] = endpoint;
        env[ENV_TOKEN] = token;
      }

      // The adapter's own account of why it did or did not attach. The probe can
      // only see the outside — no connection arrived — which leaves "wrong
      // transport", "driver not listening" and "never started" indistinguishable.
      // The clients write that distinction here (1bbe0f9), and a failure quotes
      // the file, so the attribution lands in the message rather than in an
      // artifact somebody has to go and find. A path, never `TERMWRIGHT_DEBUG=1`:
      // that means "log to stderr", which under a pty lands in the middle of the
      // frame this suite makes assertions about.
      startup.debugFile = join(
        tmpdir(),
        `termwright-adapter-debug-${randomBytes(8).toString('hex')}.log`,
      );
      env['TERMWRIGHT_DEBUG_FILE'] = startup.debugFile;

      const size = { columns: options.columns ?? 80, rows: options.rows ?? 24 };
      startup.pty = createNativePtyBackend().spawn({
        command: command.command,
        ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
        env,
        columns: size.columns,
        rows: size.rows,
        // This probe is itself the terminal emulator. Do not inherit a harness
        // shell's `TERM=dumb`: the child is connected to our xterm-compatible
        // parser regardless of which terminal launched Vitest.
        term: 'xterm-256color',
      });
      const pty = startup.pty;

      const probe = new AdapterProbe({ sessionId, token }, server, directory, pty, size, peers);
      probe.#debugFile = startup.debugFile;

      pty.onData((data) => probe.#onData(data));
      pty.onExit((status) => {
        probe.#exit = status;
        probe.#shutdown.observeExit(status);
        probe.#notifyChange();
      });
      peers.activate((socket) => probe.#onConnection(socket as Socket));
      return probe;
    } catch (error) {
      return startup.rollback(error);
    }
  }

  /** Everything observed so far. Safe to call at any point. */
  observe(): ProbeObservation {
    return {
      messages: [...this.#messages],
      markers: [...this.#markers],
      faults: [...this.#faults],
      connections: this.#connections,
      stdout: this.#stdout(),
      text: this.#text,
      screen: this.screenText(),
      logs: this.#logs.map((entry) => entry),
    };
  }

  /** The visible grid as text, trailing whitespace trimmed per row. */
  screenText(): string {
    const buffer = this.#terminal.buffer.active;
    const rows: string[] = [];
    for (let row = 0; row < this.#terminal.rows; row += 1) {
      rows.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
    }
    return rows.join('\n');
  }

  /** The child's exit status, or `null` while it is still running. */
  get exitStatus(): { code: number | null; signal: string | null } | null {
    return this.#exit;
  }

  /** Writes raw bytes to the child, exactly as a terminal would. */
  async write(input: string): Promise<void> {
    this.#pty.write(new TextEncoder().encode(input));
    await Promise.resolve();
  }

  /**
   * Resolves once `needle` appears on the rendered grid.
   *
   * Matching the byte stream instead would only work for adapters that happen
   * to write their text contiguously: a framework that positions each run of
   * cells never emits `focus: reject` as those twelve bytes in a row.
   */
  async waitForText(needle: string | RegExp, timeoutMs = 10_000): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const change = this.#armChange(deadline);
      const screen = this.screenText();
      if (needle instanceof RegExp ? needle.test(screen) : screen.includes(needle)) {
        change.cancel();
        return;
      }
      if (performance.now() >= deadline) {
        change.cancel();
        throw new Error(
          `adapter conformance: ${String(needle)} never appeared on the fixture's screen\n` +
            `screen was:\n${screen}`,
        );
      }
      await change.wait();
    }
  }

  /**
   * Resolves once `predicate` holds over the current observation.
   *
   * `what` names the thing being waited for, and the failure carries what the
   * probe could see when it gave up. "Condition never became true" is not a
   * result anybody can act on: an adapter that never connected, one that
   * connected and published nothing, and one whose binary died all produce it,
   * and only the observation tells them apart.
   */
  async waitFor(
    predicate: (observation: ProbeObservation) => boolean,
    timeoutMs = 10_000,
    what = 'the condition',
  ): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const change = this.#armChange(deadline);
      if (predicate(this.observe())) {
        change.cancel();
        return;
      }
      if (performance.now() >= deadline) {
        change.cancel();
        throw new Error(`adapter conformance: ${what} never happened — ${this.describe()}`);
      }
      await change.wait();
    }
  }

  /** What the probe has seen so far, for a failure that has to explain itself. */
  describe(): string {
    const { messages, connections } = this.observe();
    const kinds = new Map<string, number>();
    for (const recorded of messages) {
      const kind = recorded.message.type;
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    const traffic =
      kinds.size === 0 ? 'no messages' : [...kinds].map(([kind, n]) => `${kind}×${n}`).join(', ');
    const screen = this.screenText()
      .trimEnd()
      .split('\n')
      .filter((line) => line.trim() !== '');
    const exit = this.#exit === null ? 'still running' : `exited ${JSON.stringify(this.#exit)}`;
    return (
      `${connections} connection(s) to the endpoint, ${traffic}; the child is ${exit}; ` +
      `last screen line: ${JSON.stringify(screen.at(-1) ?? '')}\n${this.#adapterAccount()}`
    );
  }

  /**
   * What the adapter says about its own attach, if the client writes it.
   *
   * The outside view cannot tell "dialled the wrong transport" from "the driver
   * was not listening" from "the process never started" — all three look like
   * no connection. The clients write that distinction to `TERMWRIGHT_DEBUG_FILE`,
   * so it is quoted here rather than left in a file nobody opens. An adapter
   * that writes nothing is itself an answer, and says so.
   */
  #adapterAccount(): string {
    if (this.#debugFile === null) return 'adapter debug log: not requested';
    let contents: string;
    try {
      contents = readFileSync(this.#debugFile, 'utf8');
    } catch {
      return `adapter debug log: nothing written to ${this.#debugFile} — the client either predates the log or never ran`;
    }
    const lines = contents.trimEnd().split('\n').slice(-12);
    return `adapter debug log (last ${lines.length} line(s)):\n  ${lines.join('\n  ')}`;
  }

  /** Waits for the child to exit and returns its status. */
  async waitForExit(timeoutMs = 10_000): Promise<{ code: number | null; signal: string | null }> {
    const deadline = performance.now() + timeoutMs;
    while (this.#exit === null) {
      const change = this.#armChange(deadline);
      if (this.#exit !== null) {
        change.cancel();
        break;
      }
      if (performance.now() >= deadline) {
        change.cancel();
        throw new Error('adapter conformance: the fixture never exited');
      }
      await change.wait();
    }
    return this.#exit;
  }

  /** Cuts the semantic channel without touching the child: the disconnect case. */
  cutChannel(): void {
    this.#socket?.destroy();
    this.#socket = null;
  }

  /** Stops the child and releases the endpoint. Idempotent. */
  stop(): Promise<void> {
    return this.#shutdown.stop();
  }

  async #removeArtifacts(): Promise<void> {
    const failures: unknown[] = [];
    if (this.#directory !== null) {
      try {
        await rm(this.#directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.#debugFile !== null) {
      try {
        await rm(this.#debugFile, { force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    this.#notifyChange();
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'adapter probe artifact cleanup failed');
  }

  // -------------------------------------------------------------------------

  #stdout(): Uint8Array {
    const out = new Uint8Array(this.#bytes);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.#chunks = [out];
    return out;
  }

  #onData(data: Uint8Array): void {
    this.#chunks.push(data);
    this.#bytes += data.length;
    this.#text += Buffer.from(data).toString('utf8');
    void this.#vt.write(data).finally(() => this.#notifyChange());
    this.#scanMarkers();
    this.#notifyChange();
  }

  /** Returns emulator-owned replies without presenting them as user input. */
  #writeTerminalResponse(response: string): void {
    const data = Buffer.from(response, 'utf8');
    const write = this.#pty.writeTerminalResponse;
    if (write === undefined) {
      this.#pty.write(data, 'raw');
      return;
    }
    write.call(this.#pty, data);
  }

  #closeTerminalResponseAdmission(): void {
    this.#detachTerminalResponse?.();
    this.#detachTerminalResponse = null;
  }

  /** Finds render markers in the byte stream and verifies each against the token. */
  #scanMarkers(): void {
    MARKER_PATTERN.lastIndex = this.#markerScanFrom;
    for (;;) {
      const match = MARKER_PATTERN.exec(this.#text);
      if (match === null) break;
      const payload = match[1] ?? '';
      const verified = verifyMarkerPayload(payload, this.token, this.sessionId);
      if (verified === null) {
        this.#faults.push({
          code: 'marker',
          detail: `marker did not verify: ${JSON.stringify(payload)}`,
        });
      } else {
        this.#markers.push({ revision: verified.revision, offset: match.index, atMs: this.#now() });
      }
      this.#markerScanFrom = match.index + match[0].length;
    }
    MARKER_PATTERN.lastIndex = 0;
  }

  #onConnection(socket: Socket): void {
    this.#connections += 1;
    this.#notifyChange();
    if (this.#socket !== null) {
      // One adapter per session; a second connection is a conformance failure.
      this.#faults.push({
        code: 'second-connection',
        detail: 'the adapter opened a second channel',
      });
      socket.destroy();
      return;
    }
    this.#socket = socket;
    const decoder = createFrameDecoder(DEFAULT_LIMITS.maxFrameBytes);
    socket.on('data', (chunk: Buffer) => {
      let frames: readonly unknown[];
      try {
        frames = decoder.push(chunk);
      } catch (error) {
        this.#faults.push({
          code: 'framing',
          detail: error instanceof Error ? error.message : String(error),
        });
        this.#notifyChange();
        socket.destroy();
        return;
      }
      for (const frame of frames) this.#onFrame(socket, frame);
    });
    socket.on('close', () => {
      if (this.#socket === socket) this.#socket = null;
      this.#notifyChange();
    });
  }

  #onFrame(socket: Socket, frame: unknown): void {
    // The probe parses with the real protocol parser: a hand-written check
    // would only prove that the fixture agrees with itself.
    const parsed = parseAdapterMessage(frame, DEFAULT_LIMITS);
    if (!parsed.ok) {
      this.#faults.push({ code: parsed.code, detail: parsed.detail });
      this.#notifyChange();
      return;
    }
    this.#messages.push({ message: parsed.message, stdoutBytes: this.#bytes, atMs: this.#now() });
    if (parsed.message.type === 'log') this.#logs.push(parsed.message.record);
    this.#notifyChange();
    if (parsed.message.type !== 'hello') return;

    const ack: HelloAckMessage = {
      type: 'hello-ack',
      protocol: PROTOCOL_ID,
      sessionId: this.sessionId,
      limits: DEFAULT_LIMITS,
      subscribe: 'snapshots',
      marker: { enabled: parsed.message.capabilities.includes('render-revisions') },
      // Granted only to an adapter that asked: an adapter that never announced
      // `logs` must not be handed a budget it can then claim it was given.
      ...(parsed.message.capabilities.includes('logs') ? { logs: LOG_BUDGET } : {}),
    };
    socket.write(encodeFrame(ack, DEFAULT_LIMITS.maxFrameBytes));
  }

  #now(): number {
    return performance.now() - this.#startedAt;
  }

  #notifyChange(): void {
    for (const resolve of [...this.#changeWaiters]) resolve();
  }

  #armChange(deadline: number): { wait(): Promise<void>; cancel(): void } {
    let settled = false;
    let resolvePromise!: () => void;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.#changeWaiters.delete(finish);
      resolvePromise();
    };
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const timer = setTimeout(finish, Math.max(0, deadline - performance.now()));
    timer.unref?.();
    this.#changeWaiters.add(finish);
    return { wait: () => promise, cancel: finish };
  }
}

/** The marker prefix, re-exported so suites can assert on dormant output. */
export const MARKER_TEXT_PREFIX = `\x1b]${MARKER_OSC_CODE};${MARKER_OSC_PREFIX}`;
