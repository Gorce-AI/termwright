/**
 * Session ownership: which terminals belong to which MCP session, and the small
 * amount of history `terminal.capture_since` needs.
 *
 * Session state is keyed in *our* layer, never inside a transport object: a
 * Streamable HTTP transport is just the pipe that carries requests for a session
 * id, and the stdio transport has no session id at all. That keeps the two
 * transports interchangeable and keeps the per-session limits enforceable in one
 * place.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchTerminal } from '@termwright/driver';
import type {
  AppLogSource,
  EnvMode,
  ExitStatus,
  LaunchOptions,
  TerminalHarness,
} from '@termwright/driver';
import { DEFAULT_LIMITS } from '@termwright/protocol';
import { McpError, noSessionError, usageError } from './errors.js';
import { LogBuffer } from './logs.js';
import { definedOnly } from './objects.js';
import type { Loose } from './objects.js';
import type { SemanticSnapshot } from './model.js';
import { TraceStore } from './traces.js';

/**
 * Ceilings for the MCP layer. The session counts come from
 * `DEFAULT_LIMITS` in `@termwright/protocol`; the rest are this package's own
 * (how much capture history a terminal keeps, how long a command line may be).
 */
export const MCP_LIMITS = Object.freeze({
  /** Concurrent MCP sessions. */
  maxSessions: DEFAULT_LIMITS.maxSessions,
  /** Concurrent terminals inside one MCP session. */
  maxTerminals: DEFAULT_LIMITS.maxSessions,
  /** Snapshots retained per terminal for `capture_since` cursors. */
  maxHistory: 16,
  /** Argument ceiling for a launch command line. */
  maxCommandParts: 64,
});

/** A snapshot the server handed out, kept so a later cursor can diff against it. */
export interface RevisionRecord {
  /** Screen revision; this is the `cursor` value agents pass back. */
  readonly revision: number;
  readonly semanticRevision: number | null;
  readonly rows: readonly string[];
  readonly semantic: SemanticSnapshot | null;
  /** Log sequence at capture time, so a later diff knows where to resume. */
  readonly logSeq: number;
  readonly capturedAt: number;
}

/** One terminal owned by one MCP session. */
export interface TerminalEntry {
  /** Agent-facing handle, `t1`, `t2`, … */
  readonly id: string;
  readonly harness: TerminalHarness;
  /** Directory for `variant: "full"` dumps; created lazily. */
  readonly directory: string;
  readonly command: readonly string[];
  exit: ExitStatus | null;
  closed: boolean;
  history: RevisionRecord[];
  /** The application's own log, buffered for `terminal.capture_since`. */
  readonly logs: LogBuffer;
}

/** Options for {@link TerminalStore}. */
export interface TerminalStoreOptions {
  /** Stable key of the owning MCP session (`stdio`, or an `Mcp-Session-Id`). */
  readonly sessionKey: string;
  /** Root for on-disk snapshot dumps. Defaults to `<tmp>/termwright-mcp`. */
  readonly storageDir?: string;
  readonly maxTerminals?: number;
  /** Injectable clock, for tests. */
  readonly now?: () => number;
}

/**
 * Arguments accepted by {@link TerminalStore.launch}. Optional fields admit an
 * explicit `undefined` because they arrive from zod-parsed tool arguments.
 */
export interface LaunchRequest {
  readonly command: readonly string[];
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly envMode?: EnvMode | undefined;
  readonly columns?: number | undefined;
  readonly rows?: number | undefined;
  readonly scrollbackLines?: number | undefined;
  readonly semanticNegotiationMs?: number | undefined;
  readonly timeouts?: Loose<NonNullable<LaunchOptions['timeouts']>> | undefined;
  /** Log files to follow for the lifetime of the session. */
  readonly logs?: readonly Loose<AppLogSource>[] | undefined;
}

/** The terminals of a single MCP session, plus their capture history. */
export class TerminalStore {
  readonly sessionKey: string;
  readonly #directory: string;
  readonly #maxTerminals: number;
  readonly #now: () => number;
  readonly #terminals = new Map<string, TerminalEntry>();
  #counter = 0;

  constructor(options: TerminalStoreOptions) {
    this.sessionKey = options.sessionKey;
    this.#directory = join(options.storageDir ?? join(tmpdir(), 'termwright-mcp'), options.sessionKey);
    this.#maxTerminals = options.maxTerminals ?? MCP_LIMITS.maxTerminals;
    this.#now = options.now ?? Date.now;
  }

  /** Handles of every terminal still open in this session. */
  list(): readonly TerminalEntry[] {
    return [...this.#terminals.values()];
  }

  /** Launches a child and registers it under a fresh `t<n>` handle. */
  async launch(request: LaunchRequest): Promise<TerminalEntry> {
    if (request.command.length === 0) throw usageError('command must have at least one element');
    if (request.command.length > MCP_LIMITS.maxCommandParts) {
      throw usageError(`command may have at most ${MCP_LIMITS.maxCommandParts} elements`);
    }
    if (this.#terminals.size >= this.#maxTerminals) {
      throw new McpError(
        'capacity',
        `this session already owns ${this.#maxTerminals} terminals`,
        'close a terminal with terminal.close before launching another',
      );
    }

    const options: LaunchOptions = {
      command: [...request.command],
      // Environment policy belongs to the driver: 'replace' (its default) keeps
      // the operator's secrets out of the child, 'inherit' is opt-in.
      ...(request.env === undefined ? {} : { env: request.env }),
      ...(request.envMode === undefined ? {} : { envMode: request.envMode }),
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.columns === undefined ? {} : { columns: request.columns }),
      ...(request.rows === undefined ? {} : { rows: request.rows }),
      ...(request.scrollbackLines === undefined ? {} : { scrollbackLines: request.scrollbackLines }),
      ...(request.semanticNegotiationMs === undefined
        ? {}
        : { semanticNegotiationMs: request.semanticNegotiationMs }),
      ...(request.timeouts === undefined ? {} : { timeouts: definedOnly(request.timeouts) }),
      ...(request.logs === undefined
        ? {}
        : {
            logs: request.logs.flatMap((source) => (source.path === undefined ? [] : [{
              path: source.path,
              ...(source.label === undefined ? {} : { label: source.label }),
            }])),
          }),
    };

    const harness = await launchTerminal(options);
    this.#counter += 1;
    const id = `t${this.#counter}`;
    const entry: TerminalEntry = {
      id,
      harness,
      directory: join(this.#directory, id),
      command: [...request.command],
      exit: null,
      closed: false,
      history: [],
      logs: new LogBuffer(),
    };
    // Buffered from launch, so a log written before the first capture is not
    // lost: the driver only publishes each line once.
    harness.events.on('app-log', (event) => {
      entry.logs.append(event);
    });
    // The exit promise is observed here so `terminal.close` can report a status
    // without racing, and so an exited child never leaves an unhandled rejection.
    void harness.exit.then(
      (status) => {
        entry.exit = status;
      },
      () => {
        entry.exit = { code: null, signal: null };
      },
    );
    this.#terminals.set(id, entry);
    return entry;
  }

  /** Looks up a handle without throwing; for callers that tolerate absence. */
  find(id: string): TerminalEntry | undefined {
    return this.#terminals.get(id);
  }

  /** Looks up a handle; unknown or closed handles are a `no-session` failure. */
  get(id: string): TerminalEntry {
    const entry = this.#terminals.get(id);
    if (entry === undefined) {
      const known = [...this.#terminals.keys()];
      throw noSessionError(
        `unknown terminal ${JSON.stringify(id)}`,
        known.length === 0
          ? 'launch one with terminal.launch'
          : `open terminals: ${known.join(', ')}`,
      );
    }
    return entry;
  }

  /**
   * Captures the current screen and semantic tree, and remembers it so a later
   * `capture_since` can diff against this revision.
   */
  record(entry: TerminalEntry): RevisionRecord {
    const screen = entry.harness.screen();
    const semantic = entry.harness.semanticTree();
    const record: RevisionRecord = {
      revision: screen.revision,
      semanticRevision: semantic?.revision ?? null,
      rows: screen.text().split('\n'),
      semantic,
      logSeq: entry.logs.sequence,
      capturedAt: this.#now(),
    };
    entry.history = [...entry.history.filter((item) => item.revision !== record.revision), record].slice(
      -MCP_LIMITS.maxHistory,
    );
    return record;
  }

  /** The recorded baseline for a cursor, or a `history-truncated` failure. */
  baseline(entry: TerminalEntry, cursor: number): RevisionRecord {
    const found = entry.history.find((item) => item.revision === cursor);
    if (found !== undefined) return found;
    const known = entry.history.map((item) => item.revision);
    throw new McpError(
      'history-truncated',
      `no capture retained for cursor ${cursor}`,
      known.length === 0
        ? 'take a terminal.snapshot first; its revision is the cursor'
        : `retained cursors: ${known.join(', ')}`,
    );
  }

  /** Writes a full dump next to the session and returns its path. */
  async writeDump(entry: TerminalEntry, name: string, contents: string): Promise<string> {
    await mkdir(entry.directory, { recursive: true });
    const path = join(entry.directory, name);
    await writeFile(path, contents, 'utf8');
    return path;
  }

  /** Closes one terminal and forgets it. Idempotent. */
  async close(id: string): Promise<TerminalEntry> {
    const entry = this.get(id);
    await entry.harness.close();
    entry.closed = true;
    this.#terminals.delete(id);
    return entry;
  }

  /** Closes every terminal; failures are swallowed so shutdown always completes. */
  async closeAll(): Promise<void> {
    const entries = [...this.#terminals.values()];
    this.#terminals.clear();
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await entry.harness.close();
        } catch {
          // Shutdown is best-effort; a child that already exited is fine.
        }
        entry.closed = true;
      }),
    );
  }
}

/**
 * Everything one MCP session owns: the terminals it launched and the trace
 * archives it opened. Both are disposed together when the session goes away.
 */
export interface SessionStores {
  readonly terminals: TerminalStore;
  readonly traces: TraceStore;
}

/** Builds the stores for a session key. */
export function createSessionStores(options: {
  readonly sessionKey: string;
  readonly storageDir?: string | undefined;
}): SessionStores {
  return {
    terminals: new TerminalStore({
      sessionKey: options.sessionKey,
      ...(options.storageDir === undefined ? {} : { storageDir: options.storageDir }),
    }),
    traces: new TraceStore(),
  };
}

/** Closes both stores of a session. */
export async function closeSessionStores(stores: SessionStores): Promise<void> {
  await Promise.all([stores.terminals.closeAll(), stores.traces.closeAll()]);
}

/** A registered MCP session: its key, its stores, and its disposer. */
export interface RegisteredSession<T> {
  readonly key: string;
  readonly stores: SessionStores;
  readonly attachment: T;
  /** Clock reading of the last request that named this session. */
  lastSeenAt: number;
}

/** Options for {@link SessionRegistry}. */
export interface SessionRegistryOptions<T> {
  readonly maxSessions?: number;
  readonly storageDir?: string;
  /**
   * Milliseconds a session may sit idle before it is torn down. `0` disables
   * expiry, which is what stdio wants: there, EOF on the pipe is the signal.
   */
  readonly idleTtlMs?: number;
  /** Injectable clock, for tests. */
  readonly now?: () => number;
  /** Released alongside the stores — the transport, for a socket-backed session. */
  readonly disposeAttachment?: (attachment: T) => Promise<void> | void;
  /** Called after an idle session was torn down, for the server log. */
  readonly onExpired?: (key: string) => void;
}

/**
 * Sessions keyed by `Mcp-Session-Id` (or `stdio` for the stdio transport).
 * The registry — not the transport — owns the lifetime and the ceiling.
 */
export class SessionRegistry<T> {
  readonly #sessions = new Map<string, RegisteredSession<T>>();
  readonly #maxSessions: number;
  readonly #storageDir: string | undefined;
  readonly #idleTtlMs: number;
  readonly #now: () => number;
  readonly #disposeAttachment: ((attachment: T) => Promise<void> | void) | undefined;
  readonly #onExpired: ((key: string) => void) | undefined;
  #sweeper: NodeJS.Timeout | undefined;

  constructor(options: SessionRegistryOptions<T> = {}) {
    this.#maxSessions = options.maxSessions ?? MCP_LIMITS.maxSessions;
    this.#storageDir = options.storageDir;
    this.#idleTtlMs = options.idleTtlMs ?? 0;
    this.#now = options.now ?? Date.now;
    this.#disposeAttachment = options.disposeAttachment;
    this.#onExpired = options.onExpired;
  }

  /** The configured idle ceiling; `0` when expiry is disabled. */
  get idleTtlMs(): number {
    return this.#idleTtlMs;
  }

  /**
   * Marks a session as used. Called for **every** request that names one, so a
   * session stays alive exactly as long as someone is talking to it.
   */
  touch(key: string): void {
    const session = this.#sessions.get(key);
    if (session !== undefined) session.lastSeenAt = this.#now();
  }

  /**
   * Tears down every session idle past the TTL and returns their keys.
   *
   * Streamable HTTP has no disconnect signal: a client that crashes or walks
   * away leaves its session, its terminals and their children running, and its
   * slot taken. Repeated agent failures would then add up to an accidental
   * denial of service against the operator's own machine, so idleness is the
   * only honest liveness signal available here.
   */
  async sweepIdle(): Promise<readonly string[]> {
    if (this.#idleTtlMs <= 0) return [];
    const deadline = this.#now() - this.#idleTtlMs;
    const expired = [...this.#sessions.values()]
      .filter((session) => session.lastSeenAt <= deadline)
      .map((session) => session.key);
    for (const key of expired) {
      await this.delete(key);
      this.#onExpired?.(key);
    }
    return expired;
  }

  /**
   * Runs {@link sweepIdle} on a timer until the returned function is called.
   * The timer is unref'd, so it never keeps a process alive on its own.
   */
  startIdleSweeper(intervalMs = Math.min(Math.max(this.#idleTtlMs / 4, 1_000), 60_000)): () => void {
    if (this.#idleTtlMs <= 0) return () => undefined;
    this.#sweeper = setInterval(() => {
      void this.sweepIdle();
    }, intervalMs);
    this.#sweeper.unref?.();
    return () => this.stopIdleSweeper();
  }

  /** Stops the sweeper started by {@link startIdleSweeper}. Idempotent. */
  stopIdleSweeper(): void {
    if (this.#sweeper === undefined) return;
    clearInterval(this.#sweeper);
    this.#sweeper = undefined;
  }

  get size(): number {
    return this.#sessions.size;
  }

  /** True when another session would exceed the ceiling. */
  get atCapacity(): boolean {
    return this.#sessions.size >= this.#maxSessions;
  }

  /** Creates a session and its stores; throws `capacity` at the ceiling. */
  create(key: string, attach: (stores: SessionStores) => T): RegisteredSession<T> {
    if (this.#sessions.has(key)) throw usageError(`session ${key} already exists`);
    if (this.atCapacity) {
      throw new McpError(
        'capacity',
        `server already serves ${this.#maxSessions} MCP sessions`,
        'close an existing session (DELETE with its Mcp-Session-Id) and retry',
      );
    }
    const stores = createSessionStores({ sessionKey: key, storageDir: this.#storageDir });
    const session: RegisteredSession<T> = {
      key,
      stores,
      attachment: attach(stores),
      lastSeenAt: this.#now(),
    };
    this.#sessions.set(key, session);
    return session;
  }

  get(key: string): RegisteredSession<T> | undefined {
    return this.#sessions.get(key);
  }

  /** Removes a session and closes everything it owned. */
  async delete(key: string): Promise<void> {
    const session = this.#sessions.get(key);
    if (session === undefined) return;
    this.#sessions.delete(key);
    await closeSessionStores(session.stores);
    try {
      await this.#disposeAttachment?.(session.attachment);
    } catch {
      // A transport that already closed is not a failure to report.
    }
  }

  /** Closes every session and stops the sweeper. */
  async closeAll(): Promise<void> {
    this.stopIdleSweeper();
    const keys = [...this.#sessions.keys()];
    await Promise.all(keys.map(async (key) => this.delete(key)));
  }
}
