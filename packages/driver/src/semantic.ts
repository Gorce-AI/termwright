/**
 * Semantic channel: the private, out-of-band endpoint an instrumented
 * application connects back to.
 *
 * Lifecycle (design §4.1): the driver creates the endpoint *before* spawning
 * the child — a unix socket inside a 0700 temporary directory on POSIX, a named
 * pipe with an unguessable name on Windows — and injects
 * `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN`. Without those
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
  type LogRecord,
  type HelloAckMessage,
  type HelloMessage,
  type ProtocolErrorMessage,
  type ProbeCapability,
  type ProbeInfo,
  type ProtocolLimits,
  type ProtocolId,
  type EvidenceProviderRegistration,
  type SemanticNode,
  type SemanticSnapshot,
} from '@termwright/protocol';
import type { DiagnosticCode } from './api.js';
import { ProtocolViolationError } from './errors.js';
import { ResourceScope } from './internal/resource-scope.js';
import { endAfterFlush } from './internal/socket.js';
import { tokenMatches } from './internal/token.js';

/** Everything the driver learns from a successful handshake. */
export interface SemanticAttachment {
  readonly protocol: ProtocolId;
  readonly adapter: { readonly name: string; readonly version: string };
  readonly capabilities: readonly AdapterCapability[];
  /** True when the adapter promised render-commit markers in stdout. */
  readonly markerEnabled: boolean;
  /** True when the log channel was negotiated in the handshake. */
  readonly logsEnabled: boolean;
  /**
   * What the sender said about itself as a probe, when it is one.
   *
   * A hand-written adapter omits this and the session behaves exactly as
   * before. A probe uses it to declare the identity it can honestly offer and
   * the optional abilities it has, so the driver negotiates against measured
   * capability rather than a floor it assumed.
   */
  readonly probe: ProbeInfo | null;
  /** Application evidence providers frozen by the same hello. */
  readonly providers: readonly EvidenceProviderRegistration[];
}

/** Budget the driver grants an adapter that announced the `logs` capability. */
export interface LogBudget {
  readonly maxRecordsPerSecond: number;
  readonly burst: number;
}

/** Callbacks the session installs on the channel. */
export interface SemanticChannelHooks {
  /** A validated snapshot arrived (not yet paired with a render marker). */
  onSnapshot(snapshot: SemanticSnapshot): void;
  /**
   * An advisory `revision-commit` arrived.
   *
   * Pairing authority is the snapshot plus the render marker (design
   * §4.3): the marker *is* the commit, because only it is ordered against the
   * bytes of the render. This message says the adapter believes it committed
   * revision N; it never publishes a revision on its own, and an adapter that
   * sends commits without markers publishes nothing.
   */
  onCommit(revision: number): void;
  /**
   * A probe reports that it has begun rendering `revision` (capability
   * `frame-begin`).
   *
   * Optional by design: no audited framework has a hook guaranteed to fire
   * before every frame, so a session that never receives one is a session
   * whose frames are unannounced — never a session without frames.
   */
  onFrameBegin(revision: number): void;
  /** The handshake completed; the session is semantic from here on. */
  onAttach(attachment: SemanticAttachment): void;
  /** An attached provider disappeared; new semantic observations must fail closed. */
  onDisconnect(): void;
  /** One validated application log record arrived on the channel. */
  onLogRecord(record: LogRecord): void;
  /** Non-fatal channel diagnostics (negotiation, disconnects, advisory commits). */
  /**
   * Non-fatal channel diagnostics. `wireCode` is set whenever the entry
   * accompanies an error the driver put on the wire, whatever the diagnostic
   * code — a reader should never have to infer which failure was sent.
   */
  onDiagnostic(
    code: DiagnosticCode,
    detail: string,
    about?: { readonly revision?: number; readonly wireCode?: ErrorCode },
  ): void;
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
  /**
   * Guard for design §4.1: a late hello never flips an already selected mode.
   * The session decides when the mode is final (negotiation window plus a
   * bounded late-attach grace); until then a slow child is still welcome.
   */
  acceptHello(): boolean;
  /** Budget offered to an adapter that announced the `logs` capability. */
  readonly logBudget: LogBudget;
  /** Absolute budget for an accepted socket to authenticate with hello. */
  readonly handshakeTimeoutMs?: number;
  readonly hooks: SemanticChannelHooks;
}

/** Fault-injection seam used by transport lifecycle tests. */
export interface SemanticChannelListenDependencies {
  readonly createServer?: () => Server;
  readonly makeDirectory?: (prefix: string) => Promise<string>;
  readonly listen?: (server: Server, endpoint: string) => Promise<void>;
}

/** Capability that makes render markers — and therefore pairing — meaningful. */
const MARKER_CAPABILITY: AdapterCapability = 'render-revisions';

/** Capability that opens the application log channel. */
const LOGS_CAPABILITY: AdapterCapability = 'logs';

/** Probe ability that makes a `frame-begin` message believable. */
const FRAME_BEGIN_CAPABILITY: ProbeCapability = 'frame-begin';

const CAPABILITY_SET: ReadonlySet<string> = new Set(ADAPTER_CAPABILITIES);

/** A connected but unauthenticated peer may not occupy a session indefinitely. */
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

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

  readonly #options: SemanticChannelOptions;
  readonly #resources: ResourceScope;
  readonly #sockets = new Set<Socket>();
  readonly #handshakeTimers = new Map<Socket, NodeJS.Timeout>();
  #attached: Socket | null = null;
  #attachment: SemanticAttachment | null = null;
  #closed = false;
  #closePromise: Promise<void> | null = null;

  private constructor(
    server: Server,
    endpoint: string,
    options: SemanticChannelOptions,
    resources: ResourceScope,
  ) {
    this.endpoint = endpoint;
    this.#options = options;
    this.#resources = resources;
    resources.defer('accepted semantic sockets', () => this.#destroySockets());
    server.on('connection', (socket) => this.#handleConnection(socket));
    server.on('error', (error) => {
      options.hooks.onDiagnostic('endpoint-error', `semantic endpoint error: ${String(error)}`);
    });
  }

  /** Creates the private endpoint and starts listening. */
  static async listen(
    options: SemanticChannelOptions,
    dependencies: SemanticChannelListenDependencies = {},
  ): Promise<SemanticChannel> {
    const resources = new ResourceScope('semantic channel');
    const server = (dependencies.createServer ?? createServer)();
    let endpoint: string;
    let directory: string | null = null;
    try {
      if (process.platform === 'win32') {
        endpoint = `\\\\.\\pipe\\termwright-${randomBytes(16).toString('hex')}`;
      } else {
        directory = await (dependencies.makeDirectory ?? mkdtemp)(join(tmpdir(), 'termwright-'));
        endpoint = join(directory, 'semantic.sock');
        resources.defer('semantic socket directory', () => rm(directory!, { recursive: true, force: true }));
      }
      resources.defer('semantic listener', () => closeServer(server));
      await (dependencies.listen ?? listenServer)(server, endpoint);
      return new SemanticChannel(server, endpoint, options, resources);
    } catch (error) {
      try {
        await resources.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'semantic channel startup and rollback failed',
          { cause: error },
        );
      }
      throw error;
    }
  }

  /** The negotiated adapter, or `null` while no adapter has attached. */
  get attachment(): SemanticAttachment | null {
    return this.#attachment;
  }

  /** Closes the endpoint and removes the socket directory. Idempotent. */
  close(): Promise<void> {
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    this.#closed = true;
    this.#attached = null;
    await this.#resources.close();
  }

  #handleConnection(socket: Socket): void {
    if (this.#closed) {
      socket.destroy();
      return;
    }
    this.#sockets.add(socket);
    const handshakeTimer = setTimeout(() => {
      if (!this.#sockets.has(socket) || this.#attached === socket) return;
      this.#options.hooks.onDiagnostic(
        'endpoint-error',
        `semantic peer did not authenticate within ${this.#options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS} ms`,
      );
      this.#refuse(socket, 'internal', 'semantic hello deadline exceeded');
    }, this.#options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);
    handshakeTimer.unref?.();
    this.#handshakeTimers.set(socket, handshakeTimer);

    if (this.#attached !== null) {
      // One adapter per session; a second connection is refused, not raced.
      this.#refuse(socket, 'internal', 'a semantic adapter is already attached');
      this.#options.hooks.onDiagnostic(
        'adapter-capability',
        'refused a second adapter connection: this session already has one attached',
        { wireCode: 'internal' },
      );
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
      this.#sockets.delete(socket);
      this.#clearHandshakeTimer(socket);
      if (this.#attached === socket) {
        this.#attached = null;
        if (!this.#closed) {
          this.#options.hooks.onDiagnostic('adapter-disconnected', 'the semantic adapter disconnected');
          this.#options.hooks.onDisconnect();
        }
      }
    });
  }

  #handleHello(socket: Socket, hello: HelloMessage): boolean {
    // Connections are admitted before they authenticate. Re-check at the
    // claim itself so two sockets accepted in the same turn cannot both win.
    if (this.#attached !== null && this.#attached !== socket) {
      this.#refuse(socket, 'internal', 'a semantic adapter is already attached');
      this.#options.hooks.onDiagnostic(
        'adapter-capability',
        'refused a concurrent adapter hello: this session already has one attached',
        { wireCode: 'internal' },
      );
      return false;
    }
    if (!this.#options.acceptHello()) {
      this.#refuse(
        socket,
        'internal',
        'the negotiation window has closed; this session already settled as generic',
      );
      this.#options.hooks.onDiagnostic(
        'adapter-capability',
        `refusing a hello from ${hello.adapter.name}: the session settled as generic before it connected`,
        { wireCode: 'internal' },
      );
      return false;
    }
    if (!tokenMatches(this.#options.token, hello.token)) {
      this.#fail(socket, 'bad-token', 'handshake token mismatch');
      return false;
    }
    const capabilities = hello.capabilities.filter((entry): entry is AdapterCapability =>
      CAPABILITY_SET.has(entry),
    );

    this.#attached = socket;
    this.#clearHandshakeTimer(socket);
    const markerEnabled = capabilities.includes(MARKER_CAPABILITY);
    const logsEnabled = capabilities.includes(LOGS_CAPABILITY);
    const ack: HelloAckMessage = {
      type: 'hello-ack',
      protocol: hello.protocol,
      sessionId: this.#options.sessionId,
      limits: this.#options.limits,
      subscribe: 'snapshots',
      marker: { enabled: markerEnabled },
      // Absent means disabled: an adapter without this field must stay quiet.
      ...(logsEnabled ? { logs: { enabled: true, ...this.#options.logBudget } } : {}),
    };
    this.#send(socket, ack);
    this.#attachment = Object.freeze({
      protocol: hello.protocol,
      adapter: Object.freeze({ name: hello.adapter.name, version: hello.adapter.version }),
      capabilities: Object.freeze(capabilities),
      markerEnabled,
      logsEnabled,
      probe:
        hello.probe === undefined
          ? null
          : Object.freeze({
              ...hello.probe,
              capabilities: Object.freeze([...hello.probe.capabilities]),
            }),
      providers: Object.freeze((hello.providers ?? []).map((provider) => Object.freeze({
        id: provider.id,
        version: provider.version,
        method: provider.method,
        capabilities: Object.freeze([...provider.capabilities]),
      }))),
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
      case 'frame-begin': {
        // Honoured only from a probe that declared it. A frame signal from a
        // sender that never claimed the ability is not worth closing the
        // channel over — it is worth not believing, and saying so.
        if (this.#attachment?.probe?.capabilities.includes(FRAME_BEGIN_CAPABILITY) !== true) {
          this.#options.hooks.onDiagnostic(
            'adapter-capability',
            `ignoring a frame-begin for revision ${message.revision}: ` +
              `the sender did not announce the '${FRAME_BEGIN_CAPABILITY}' probe capability`,
            { revision: message.revision },
          );
          return true;
        }
        this.#options.hooks.onFrameBegin(message.revision);
        return true;
      }
      case 'snapshot': {
        if (message.snapshot.sessionId !== this.#options.sessionId) {
          this.#fail(socket, 'malformed', 'snapshot carries a foreign sessionId');
          return false;
        }
        if (message.snapshot.v !== 2) {
          this.#fail(socket, 'bad-version', `snapshot v${message.snapshot.v} does not match negotiated ${PROTOCOL_ID}`);
          return false;
        }
        if (!this.#acceptsTreeFields(socket, message.snapshot.nodes, 'snapshot')) return false;
        if (message.snapshot.hitGrid.status === 'known' && this.#attachment?.capabilities.includes('pointer-hit-grid') !== true) {
          this.#fail(socket, 'malformed', "snapshot contains a known hit grid without the 'pointer-hit-grid' capability");
          return false;
        }
        this.#acceptTree(message.snapshot);
        return true;
      }
      case 'log': {
        if (this.#attachment?.logsEnabled !== true) {
          // The budget was never granted, so these records were never invited.
          this.#fail(socket, 'malformed', 'log record sent without a negotiated log channel');
          return false;
        }
        this.#options.hooks.onLogRecord(message.record);
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
      default:
        this.#fail(socket, 'malformed', 'unknown message type');
        return false;
    }
  }

  /** Records a tree as the newest one held, and hands it to the session. */
  #acceptTree(snapshot: SemanticSnapshot): void {
    this.#options.hooks.onSnapshot(snapshot);
  }

  /**
   * Enforces the promises made by Hello before any optional tree fact can
   * influence locators. Shape validation proves that a field is well-formed;
   * this gate proves that the sender was entitled to send it.
   *
   * Geometry observations are required by the v2 snapshot schema. The
   * handshake separately declares whether intended and clipped geometry are
   * guaranteed by this session contract.
   */
  #acceptsTreeFields(socket: Socket, nodes: readonly SemanticNode[], message: string): boolean {
    const capabilities = this.#attachment?.capabilities ?? [];
    const has = (capability: AdapterCapability): boolean => capabilities.includes(capability);
    const reject = (detail: string): false => {
      this.#fail(socket, 'malformed', `${message} ${detail}`);
      return false;
    };

    if (!has('tree')) return reject("sent without the 'tree' capability");
    for (const node of nodes) {
      if (node.state !== undefined && !has('states')) {
        return reject("contains state without the 'states' capability");
      }
      if (node.state?.focused !== undefined && !has('focus-state')) {
        return reject("contains focused state without the 'focus-state' capability");
      }
      if (node.extended !== undefined && !has('states')) {
        return reject("contains extended state without the 'states' capability");
      }
      if (node.actions !== undefined && !has('actions')) {
        return reject("contains actions without the 'actions' capability");
      }
      if (node.inputRecipes !== undefined && !has('action-recipes')) {
        return reject("contains input recipes without the 'action-recipes' capability");
      }
      if (node.textRanges !== undefined && !has('text-ranges')) {
        return reject("contains text ranges without the 'text-ranges' capability");
      }
    }
    return true;
  }

  #send(socket: Socket, message: unknown): void {
    try {
      socket.write(encodeFrame(message, this.#options.limits.maxFrameBytes));
    } catch (error) {
      this.#options.hooks.onDiagnostic('endpoint-error', `failed to send frame: ${errorDetail(error)}`);
    }
  }

  /**
   * Sends a refusal and closes the socket only once the frame is on its way.
   *
   * Writing and destroying in the same turn drops whatever has not flushed
   * yet, which loses exactly the message an adapter author needs: the reason
   * their connection was refused.
   */
  #refuse(socket: Socket, code: ErrorCode, message: string): void {
    const error: ProtocolErrorMessage = { type: 'error', code, message };
    try {
      endAfterFlush(socket, encodeFrame(error, this.#options.limits.maxFrameBytes));
    } catch {
      socket.destroy();
    }
  }

  #fail(
    socket: Socket,
    code: ErrorCode | 'bad-version' | 'limit-exceeded',
    detail: string,
    violation?: string,
  ): void {
    this.#refuse(socket, code as ErrorCode, detail);
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

  #clearHandshakeTimer(socket: Socket): void {
    const timer = this.#handshakeTimers.get(socket);
    if (timer !== undefined) clearTimeout(timer);
    this.#handshakeTimers.delete(socket);
  }

  #destroySockets(): void {
    for (const timer of this.#handshakeTimers.values()) clearTimeout(timer);
    this.#handshakeTimers.clear();
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
  }
}

function listenServer(server: Server, endpoint: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The machine-readable reason `@termwright/protocol` failed closed with. */
function violationCode(error: unknown): string | undefined {
  return error instanceof ProtocolViolation ? error.code : undefined;
}
