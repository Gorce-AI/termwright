/**
 * Semantic channel: the private, out-of-band endpoint an instrumented
 * application connects back to.
 *
 * Lifecycle (design §4.1): the driver creates the endpoint *before* spawning
 * the child — a unix socket inside a 0700 temporary directory on POSIX, a named
 * pipe with an unguessable name on Windows — and injects
 * `TERMWRIGHT_ENDPOINT`/`TERMWRIGHT_TOKEN`/`TERMWRIGHT_PROTOCOL`. Without those
 * variables a conforming adapter stays dormant, so an uninstrumented run is
 * byte-for-byte identical.
 *
 * Wire handling is delegated to `@termwright/protocol`: framing, DTO
 * projection, message shape and snapshot validation all fail closed there. This
 * module owns only the transport, the token check and the session policy (one
 * adapter, marker negotiation).
 */
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ADAPTER_CAPABILITIES,
  ProtocolViolation,
  type ProtocolViolationCode,
  createFrameDecoder,
  encodeFrame,
  parseAdapterMessage,
  PROTOCOL_ID,
  type AdapterCapability,
  type AdapterToDriverMessage,
  type HelloAckMessage,
  type HelloMessage,
  type ProtocolErrorMessage,
  type ProtocolLimits,
  type SemanticSnapshot,
} from '@termwright/protocol';
import type { DiagnosticCode } from './api.js';
import { ProtocolViolationError } from './errors.js';
import { tokenMatches } from './internal/token.js';

/** Everything the driver learns from a successful handshake. */
export interface SemanticAttachment {
  readonly adapter: { readonly name: string; readonly version: string };
  readonly capabilities: readonly AdapterCapability[];
  /** True when the adapter promised render-commit markers in stdout. */
  readonly markerEnabled: boolean;
}

/** Callbacks the session installs on the channel. */
export interface SemanticChannelHooks {
  /** A validated snapshot arrived (not yet paired with a render marker). */
  onSnapshot(snapshot: SemanticSnapshot): void;
  /**
   * An advisory `revision-commit` arrived.
   *
   * Pairing authority is the snapshot plus the DCS render marker (design
   * §4.3): the marker *is* the commit, because only it is ordered against the
   * bytes of the render. This message says the adapter believes it committed
   * revision N; it never publishes a revision on its own, and an adapter that
   * sends commits without markers publishes nothing.
   */
  onCommit(revision: number): void;
  /** The handshake completed; the session is semantic from here on. */
  onAttach(attachment: SemanticAttachment): void;
  /** Non-fatal channel diagnostics (negotiation, disconnects, advisory commits). */
  onDiagnostic(code: DiagnosticCode, detail: string, revision?: number): void;
  /**
   * The channel failed and was closed; the session stays on its last tree.
   * `@termwright/protocol` fails closed with its own `ProtocolViolation`; the
   * driver owns the boundary, so the error handed over here is always the
   * driver's typed {@link ProtocolViolationError}.
   */
  onProtocolViolation(error: ProtocolViolationError, wireCode: ProtocolErrorMessage['code']): void;
}

/** Construction options for {@link SemanticChannel}. */
export interface SemanticChannelOptions {
  readonly sessionId: string;
  readonly token: string;
  readonly limits: ProtocolLimits;
  readonly hooks: SemanticChannelHooks;
}

/** Capability that makes render markers — and therefore pairing — meaningful. */
const MARKER_CAPABILITY: AdapterCapability = 'render-revisions';

const CAPABILITY_SET: ReadonlySet<string> = new Set(ADAPTER_CAPABILITIES);

type ErrorCode = ProtocolErrorMessage['code'];

/**
 * Wire classification of the protocol's machine-readable violation codes.
 *
 * The decoder projects a frame body while decoding it, so ceiling breaches
 * (depth, frame size) surface as thrown violations rather than as a parser
 * result. Mapping them to `malformed` would tell an adapter author that their
 * JSON is broken when the real problem is that their tree is too deep, so the
 * ceilings are classified as `limit-exceeded` here — the same code
 * `parseAdapterMessage` uses when the identical breach takes the other path.
 */
const WIRE_CODE_BY_VIOLATION: Readonly<Partial<Record<ProtocolViolationCode, ErrorCode>>> =
  Object.freeze({
    'frame-oversized': 'limit-exceeded',
    'dto-depth': 'limit-exceeded',
  });

/** Wire code for a decoder failure; anything not a ceiling breach is malformed. */
function wireCodeFor(error: unknown): ErrorCode {
  if (!(error instanceof ProtocolViolation)) return 'malformed';
  return WIRE_CODE_BY_VIOLATION[error.code] ?? 'malformed';
}

/**
 * The listening endpoint plus the single attached adapter connection.
 * Create it with {@link SemanticChannel.listen} before spawning the child.
 */
export class SemanticChannel {
  readonly endpoint: string;

  readonly #server: Server;
  readonly #options: SemanticChannelOptions;
  readonly #directory: string | null;
  #attached: Socket | null = null;
  #attachment: SemanticAttachment | null = null;
  #closed = false;

  private constructor(
    server: Server,
    endpoint: string,
    directory: string | null,
    options: SemanticChannelOptions,
  ) {
    this.#server = server;
    this.endpoint = endpoint;
    this.#directory = directory;
    this.#options = options;
    server.on('connection', (socket) => this.#handleConnection(socket));
    server.on('error', (error) => {
      options.hooks.onDiagnostic('endpoint-error', `semantic endpoint error: ${String(error)}`);
    });
  }

  /** Creates the private endpoint and starts listening. */
  static async listen(options: SemanticChannelOptions): Promise<SemanticChannel> {
    const server = createServer();
    let endpoint: string;
    let directory: string | null = null;
    if (process.platform === 'win32') {
      endpoint = `\\\\.\\pipe\\termwright-${randomBytes(16).toString('hex')}`;
    } else {
      directory = await mkdtemp(join(tmpdir(), 'termwright-'));
      endpoint = join(directory, 'semantic.sock');
    }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    return new SemanticChannel(server, endpoint, directory, options);
  }

  /** The negotiated adapter, or `null` while no adapter has attached. */
  get attachment(): SemanticAttachment | null {
    return this.#attachment;
  }

  /** Closes the endpoint and removes the socket directory. Idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#attached?.destroy();
    this.#attached = null;
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    if (this.#directory !== null) {
      await rm(this.#directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  #handleConnection(socket: Socket): void {
    if (this.#closed) {
      socket.destroy();
      return;
    }
    if (this.#attached !== null) {
      // One adapter per session; a second connection is refused, not raced.
      this.#sendError(socket, 'internal', 'a semantic adapter is already attached');
      socket.destroy();
      return;
    }

    const decoder = createFrameDecoder(this.#options.limits.maxFrameBytes);
    let helloSeen = false;

    socket.on('data', (chunk: Buffer) => {
      let frames: readonly unknown[];
      try {
        frames = decoder.push(chunk);
      } catch (error) {
        // The protocol decoder is permanently poisoned after any violation, so
        // the connection goes with it rather than resynchronising on an offset
        // an attacker chose.
        this.#fail(socket, wireCodeFor(error), `framing: ${errorDetail(error)}`, violationCode(error));
        return;
      }
      for (const frame of frames) {
        const parsed = parseAdapterMessage(frame, this.#options.limits);
        if (!parsed.ok) {
          this.#fail(socket, parsed.code, parsed.detail);
          return;
        }
        const message = parsed.message;
        if (!helloSeen) {
          if (message.type !== 'hello') {
            this.#fail(socket, 'malformed', `expected hello, received ${message.type}`);
            return;
          }
          if (!this.#handleHello(socket, message)) return;
          helloSeen = true;
          continue;
        }
        if (!this.#handleMessage(socket, message)) return;
      }
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      if (this.#attached === socket) {
        this.#attached = null;
        this.#options.hooks.onDiagnostic('adapter-disconnected', 'the semantic adapter disconnected');
      }
    });
  }

  #handleHello(socket: Socket, hello: HelloMessage): boolean {
    if (!tokenMatches(this.#options.token, hello.token)) {
      this.#fail(socket, 'bad-token', 'handshake token mismatch');
      return false;
    }
    const capabilities = hello.capabilities.filter((entry): entry is AdapterCapability =>
      CAPABILITY_SET.has(entry),
    );

    this.#attached = socket;
    const markerEnabled = capabilities.includes(MARKER_CAPABILITY);
    const ack: HelloAckMessage = {
      type: 'hello-ack',
      protocol: PROTOCOL_ID,
      sessionId: this.#options.sessionId,
      limits: this.#options.limits,
      subscribe: 'snapshots',
      marker: { enabled: markerEnabled },
    };
    this.#send(socket, ack);
    this.#attachment = Object.freeze({
      adapter: Object.freeze({ name: hello.adapter.name, version: hello.adapter.version }),
      capabilities: Object.freeze(capabilities),
      markerEnabled,
    });
    this.#options.hooks.onAttach(this.#attachment);
    if (!markerEnabled) {
      this.#options.hooks.onDiagnostic(
        'adapter-capability',
        `adapter ${hello.adapter.name} did not announce the '${MARKER_CAPABILITY}' capability: ` +
          'semantic revisions are published on arrival instead of being paired with a render',
      );
    }
    return true;
  }

  #handleMessage(socket: Socket, message: AdapterToDriverMessage): boolean {
    switch (message.type) {
      case 'revision-commit':
        this.#options.hooks.onCommit(message.revision);
        return true;
      case 'snapshot': {
        if (message.snapshot.sessionId !== this.#options.sessionId) {
          this.#fail(socket, 'malformed', 'snapshot carries a foreign sessionId');
          return false;
        }
        this.#options.hooks.onSnapshot(message.snapshot);
        return true;
      }
      case 'hello':
        this.#fail(socket, 'malformed', 'duplicate hello');
        return false;
      case 'error':
        this.#options.hooks.onProtocolViolation(
          new ProtocolViolationError(`the adapter reported a protocol error: ${message.message}`, {
            semanticTree: this.#attachment !== null,
            suggestion: `adapter error code: ${message.code}`,
          }),
          message.code,
        );
        socket.destroy();
        this.#attached = null;
        return false;
      case 'get-tree-result':
        // v1 subscribes to pushed snapshots; a response without a request is noise.
        this.#options.hooks.onDiagnostic(
          'adapter-capability',
          'ignoring an unsolicited get-tree-result: this driver subscribes to pushed snapshots',
        );
        return true;
      default:
        this.#fail(socket, 'malformed', 'unknown message type');
        return false;
    }
  }

  #send(socket: Socket, message: unknown): void {
    try {
      socket.write(encodeFrame(message, this.#options.limits.maxFrameBytes));
    } catch (error) {
      this.#options.hooks.onDiagnostic('endpoint-error', `failed to send frame: ${errorDetail(error)}`);
    }
  }

  #sendError(socket: Socket, code: ErrorCode, message: string): void {
    const error: ProtocolErrorMessage = { type: 'error', code, message };
    this.#send(socket, error);
  }

  #fail(
    socket: Socket,
    code: ErrorCode | 'bad-version' | 'limit-exceeded',
    detail: string,
    violation?: string,
  ): void {
    this.#sendError(socket, code as ErrorCode, detail);
    socket.destroy();
    if (this.#attached === socket) this.#attached = null;
    const wireCode = code as ErrorCode;
    this.#options.hooks.onProtocolViolation(
      new ProtocolViolationError(`the semantic channel was closed: ${detail}`, {
        semanticTree: this.#attachment !== null,
        suggestion: `wire error ${code}${violation === undefined ? '' : ` (${violation})`}; ` +
          'the adapter must be fixed — the session keeps its last accepted tree and stops updating it',
      }),
      wireCode,
    );
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The machine-readable reason `@termwright/protocol` failed closed with. */
function violationCode(error: unknown): string | undefined {
  return error instanceof ProtocolViolation ? error.code : undefined;
}
