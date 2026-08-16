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
  applyTreeDelta,
  type GetTreeRequest,
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
  type ProtocolLimits,
  type SemanticSnapshot,
} from '@termwright/protocol';
import type { DiagnosticCode } from './api.js';
import { ProtocolViolationError } from './errors.js';
import { endAfterFlush } from './internal/socket.js';
import { tokenMatches } from './internal/token.js';

/** Everything the driver learns from a successful handshake. */
export interface SemanticAttachment {
  readonly adapter: { readonly name: string; readonly version: string };
  readonly capabilities: readonly AdapterCapability[];
  /** True when the adapter promised render-commit markers in stdout. */
  readonly markerEnabled: boolean;
  /** True when the log channel was negotiated in the handshake. */
  readonly logsEnabled: boolean;
  /** True when the adapter pushes deltas instead of full trees. */
  readonly deltasEnabled: boolean;
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
   * Pairing authority is the snapshot plus the DCS render marker (design
   * §4.3): the marker *is* the commit, because only it is ordered against the
   * bytes of the render. This message says the adapter believes it committed
   * revision N; it never publishes a revision on its own, and an adapter that
   * sends commits without markers publishes nothing.
   */
  onCommit(revision: number): void;
  /** The handshake completed; the session is semantic from here on. */
  onAttach(attachment: SemanticAttachment): void;
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
  /** False forces full snapshots even from an adapter that offers deltas. */
  readonly acceptDeltas: boolean;
  readonly hooks: SemanticChannelHooks;
}

/** Capability that makes render markers — and therefore pairing — meaningful. */
const MARKER_CAPABILITY: AdapterCapability = 'render-revisions';

/** Capability that opens the application log channel. */
const LOGS_CAPABILITY: AdapterCapability = 'logs';

/** Capability that lets an adapter send deltas instead of whole trees. */
const DIFFS_CAPABILITY: AdapterCapability = 'tree-diffs';

/** How long a `get-tree` may take before the resync is abandoned. */
const GET_TREE_TIMEOUT_MS = 2_000;

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
  /**
   * Head of the delta chain: the newest tree the driver holds, published or
   * not. Pairing decides what becomes observable; composition needs the latest
   * accepted tree regardless, because the next delta is based on it.
   */
  #composed: SemanticSnapshot | null = null;
  /** While true, deltas are dropped: a full tree is on its way. */
  #resyncing = false;
  #requestId = 0;
  #getTreeTimer: NodeJS.Timeout | null = null;

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
    this.#finishResync();
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
      if (this.#attached === socket) {
        this.#attached = null;
        this.#options.hooks.onDiagnostic('adapter-disconnected', 'the semantic adapter disconnected');
      }
    });
  }

  #handleHello(socket: Socket, hello: HelloMessage): boolean {
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
    const markerEnabled = capabilities.includes(MARKER_CAPABILITY);
    const logsEnabled = capabilities.includes(LOGS_CAPABILITY);
    const deltasEnabled = this.#options.acceptDeltas && capabilities.includes(DIFFS_CAPABILITY);
    const ack: HelloAckMessage = {
      type: 'hello-ack',
      protocol: PROTOCOL_ID,
      sessionId: this.#options.sessionId,
      limits: this.#options.limits,
      subscribe: deltasEnabled ? 'diffs' : 'snapshots',
      marker: { enabled: markerEnabled },
      // Absent means disabled: an adapter without this field must stay quiet.
      ...(logsEnabled ? { logs: { enabled: true, ...this.#options.logBudget } } : {}),
    };
    this.#send(socket, ack);
    this.#attachment = Object.freeze({
      adapter: Object.freeze({ name: hello.adapter.name, version: hello.adapter.version }),
      capabilities: Object.freeze(capabilities),
      markerEnabled,
      logsEnabled,
      deltasEnabled,
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
        this.#acceptTree(message.snapshot);
        return true;
      }
      case 'tree-delta': {
        if (this.#resyncing) {
          // A full tree is already on its way; patching onto a base we know is
          // wrong would only produce a second wrong tree.
          return true;
        }
        const base = this.#composed;
        if (base === null) {
          this.#resync(socket, `a delta for revision ${message.revision} arrived before any full tree`);
          return true;
        }
        const composed = applyTreeDelta(base, message, this.#options.limits);
        if (!composed.ok) {
          this.#resync(
            socket,
            `delta ${message.baseRevision}→${message.revision} did not compose (${composed.code}): ${composed.detail}`,
            message.revision,
          );
          return true;
        }
        this.#acceptTree(composed.snapshot);
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
      case 'get-tree-result': {
        if (!this.#resyncing) {
          this.#options.hooks.onDiagnostic(
            'adapter-capability',
            'ignoring a get-tree-result that answers no outstanding request',
          );
          return true;
        }
        if (message.snapshot === undefined) {
          this.#finishResync();
          this.#options.hooks.onDiagnostic(
            'delta-resync',
            `the adapter could not supply a full tree: ${message.error ?? 'no reason given'}`,
          );
          return true;
        }
        if (message.snapshot.sessionId !== this.#options.sessionId) {
          this.#fail(socket, 'malformed', 'get-tree-result carries a foreign sessionId');
          return false;
        }
        this.#finishResync();
        const held = this.#composed;
        const current = held !== null && message.snapshot.revision <= held.revision;
        this.#options.hooks.onDiagnostic(
          'delta-resync',
          current
            ? `resynchronised: the full tree is revision ${message.snapshot.revision}, which is already held`
            : `resynchronised on revision ${message.snapshot.revision} from a full tree`,
          { revision: message.snapshot.revision },
        );
        // A tree the session already published must not be offered again: the
        // pairing would report it as a dropped revision, and a repair that
        // reads like data loss is worse than no report at all. It still
        // replaces the composition base, because it is the authoritative one.
        if (current) this.#composed = message.snapshot;
        else this.#acceptTree(message.snapshot);
        return true;
      }
      default:
        this.#fail(socket, 'malformed', 'unknown message type');
        return false;
    }
  }

  /** Records a tree as the newest one held, and hands it to the session. */
  #acceptTree(snapshot: SemanticSnapshot): void {
    this.#composed = snapshot;
    this.#options.hooks.onSnapshot(snapshot);
  }

  /**
   * Asks for a full tree and stops trusting deltas until it arrives.
   *
   * Per design §8.3 a receiver that cannot compose must rehydrate rather than
   * patch around the gap. Nothing is lost here — the last good tree stays
   * observable while the new one is fetched — so this is reported as a resync,
   * not as dropped data.
   */
  #resync(socket: Socket, reason: string, revision?: number): void {
    this.#options.hooks.onDiagnostic(
      'delta-resync',
      `requesting a full tree: ${reason}`,
      revision === undefined ? undefined : { revision },
    );
    if (this.#resyncing) return;
    this.#resyncing = true;
    this.#requestId += 1;
    const request: GetTreeRequest = { type: 'get-tree', requestId: this.#requestId };
    this.#send(socket, request);
    this.#getTreeTimer = setTimeout(() => {
      this.#getTreeTimer = null;
      if (!this.#resyncing) return;
      this.#resyncing = false;
      // Giving up on the request rather than the session: a later pushed
      // snapshot still repairs the chain, and deltas resume from it.
      this.#options.hooks.onDiagnostic(
        'delta-resync',
        `no full tree arrived within ${GET_TREE_TIMEOUT_MS} ms; waiting for the adapter to push one`,
      );
    }, GET_TREE_TIMEOUT_MS);
    this.#getTreeTimer.unref?.();
  }

  #finishResync(): void {
    this.#resyncing = false;
    if (this.#getTreeTimer !== null) {
      clearTimeout(this.#getTreeTimer);
      this.#getTreeTimer = null;
    }
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
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The machine-readable reason `@termwright/protocol` failed closed with. */
function violationCode(error: unknown): string | undefined {
  return error instanceof ProtocolViolation ? error.code : undefined;
}
