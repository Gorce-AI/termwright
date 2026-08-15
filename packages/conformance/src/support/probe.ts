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
 * It is not a second driver: it never renders, never locates and never acts.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  DEFAULT_LIMITS,
  ENV_ENDPOINT,
  ENV_PROTOCOL,
  ENV_TOKEN,
  MARKER_DCS_PREFIX,
  parseAdapterMessage,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  createFrameDecoder,
  encodeFrame,
  generateToken,
  verifyMarkerPayload,
  type AdapterToDriverMessage,
  type HelloAckMessage,
} from '@termwright/protocol';
import { createNodePtyBackend, type PtyProcess } from '@termwright/driver';
import { environment } from './pty.js';

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
  readonly text: string;
}

const MARKER_PATTERN = /\x1bP(twm;[0-9]+;[A-Za-z0-9_-]+)\x1b\\/gu;

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
  readonly #startedAt = performance.now();
  readonly #messages: RecordedMessage[] = [];
  readonly #markers: RecordedMarker[] = [];
  readonly #faults: RecordedFault[] = [];
  #chunks: Uint8Array[] = [];
  #bytes = 0;
  #text = '';
  #markerScanFrom = 0;
  #connections = 0;
  #socket: Socket | null = null;
  #exit: { code: number | null; signal: string | null } | null = null;
  #stopped = false;

  private constructor(
    identity: { readonly sessionId: string; readonly token: string },
    server: Server | null,
    directory: string | null,
    pty: PtyProcess,
  ) {
    this.sessionId = identity.sessionId;
    this.token = identity.token;
    this.#server = server;
    this.#directory = directory;
    this.#pty = pty;
  }

  /** Creates the endpoint (unless dormant), then spawns the fixture. */
  static async start(command: AdapterCommand, options: ProbeOptions = {}): Promise<AdapterProbe> {
    const instrument = options.instrument ?? true;
    const sessionId = randomUUID();
    const token = generateToken();

    let server: Server | null = null;
    let directory: string | null = null;
    let endpoint: string | null = null;

    if (instrument) {
      server = createServer();
      if (process.platform === 'win32') {
        endpoint = `\\\\.\\pipe\\termwright-probe-${randomBytes(16).toString('hex')}`;
      } else {
        directory = await mkdtemp(join(tmpdir(), 'termwright-probe-'));
        endpoint = join(directory, 'semantic.sock');
      }
      const listening = server;
      const address = endpoint;
      await new Promise<void>((resolve, reject) => {
        listening.once('error', reject);
        listening.listen(address, () => {
          listening.removeListener('error', reject);
          resolve();
        });
      });
    }

    const env = environment(command.env);
    // A dormant run must not merely lack our endpoint — it must not inherit one
    // from whatever process is running the suite.
    delete env[ENV_ENDPOINT];
    delete env[ENV_TOKEN];
    delete env[ENV_PROTOCOL];
    if (endpoint !== null) {
      env[ENV_ENDPOINT] = endpoint;
      env[ENV_TOKEN] = token;
      env[ENV_PROTOCOL] = String(PROTOCOL_VERSION);
    }

    const pty = createNodePtyBackend().spawn({
      command: command.command,
      ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
      env,
      columns: options.columns ?? 80,
      rows: options.rows ?? 24,
    });

    const probe = new AdapterProbe({ sessionId, token }, server, directory, pty);

    pty.onData((data) => probe.#onData(data));
    pty.onExit((status) => {
      probe.#exit = status;
    });
    server?.on('connection', (socket) => probe.#onConnection(socket));
    return probe;
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
    };
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

  /** Resolves once `needle` appears in everything the child has written. */
  async waitForText(needle: string | RegExp, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (needle instanceof RegExp ? needle.test(this.#text) : this.#text.includes(needle)) return;
      if (Date.now() >= deadline) {
        throw new Error(
          `adapter conformance: ${String(needle)} never appeared in the fixture's output\n` +
            `last 400 bytes: ${JSON.stringify(this.#text.slice(-400))}`,
        );
      }
      await delay(20);
    }
  }

  /** Resolves once `predicate` holds over the current observation. */
  async waitFor(predicate: (observation: ProbeObservation) => boolean, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (predicate(this.observe())) return;
      if (Date.now() >= deadline) throw new Error('adapter conformance: condition never became true');
      await delay(20);
    }
  }

  /** Waits for the child to exit and returns its status. */
  async waitForExit(timeoutMs = 10_000): Promise<{ code: number | null; signal: string | null }> {
    const deadline = Date.now() + timeoutMs;
    while (this.#exit === null) {
      if (Date.now() >= deadline) throw new Error('adapter conformance: the fixture never exited');
      await delay(20);
    }
    return this.#exit;
  }

  /** Cuts the semantic channel without touching the child: the disconnect case. */
  cutChannel(): void {
    this.#socket?.destroy();
    this.#socket = null;
  }

  /** Stops the child and releases the endpoint. Idempotent. */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#socket?.destroy();
    this.#pty.dispose();
    if (this.#server !== null) await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
    if (this.#directory !== null) await rm(this.#directory, { recursive: true, force: true }).catch(() => {});
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
    this.#scanMarkers();
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
        this.#faults.push({ code: 'marker', detail: `marker did not verify: ${JSON.stringify(payload)}` });
      } else {
        this.#markers.push({ revision: verified.revision, offset: match.index, atMs: this.#now() });
      }
      this.#markerScanFrom = match.index + match[0].length;
    }
    MARKER_PATTERN.lastIndex = 0;
  }

  #onConnection(socket: Socket): void {
    this.#connections += 1;
    if (this.#socket !== null) {
      // One adapter per session; a second connection is a conformance failure.
      this.#faults.push({ code: 'second-connection', detail: 'the adapter opened a second channel' });
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
        this.#faults.push({ code: 'framing', detail: error instanceof Error ? error.message : String(error) });
        socket.destroy();
        return;
      }
      for (const frame of frames) this.#onFrame(socket, frame);
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      if (this.#socket === socket) this.#socket = null;
    });
  }

  #onFrame(socket: Socket, frame: unknown): void {
    // The probe parses with the real protocol parser: a hand-written check
    // would only prove that the fixture agrees with itself.
    const parsed = parseAdapterMessage(frame, DEFAULT_LIMITS);
    if (!parsed.ok) {
      this.#faults.push({ code: parsed.code, detail: parsed.detail });
      return;
    }
    this.#messages.push({ message: parsed.message, stdoutBytes: this.#bytes, atMs: this.#now() });
    if (parsed.message.type !== 'hello') return;

    const ack: HelloAckMessage = {
      type: 'hello-ack',
      protocol: PROTOCOL_ID,
      sessionId: this.sessionId,
      limits: DEFAULT_LIMITS,
      subscribe: 'snapshots',
      marker: { enabled: parsed.message.capabilities.includes('render-revisions') },
    };
    socket.write(encodeFrame(ack, DEFAULT_LIMITS.maxFrameBytes));
  }

  #now(): number {
    return performance.now() - this.#startedAt;
  }
}

/** The marker prefix, re-exported so suites can assert on dormant output. */
export const MARKER_TEXT_PREFIX = `\x1bP${MARKER_DCS_PREFIX}`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
