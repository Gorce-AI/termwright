/**
 * A minimal driver stand-in used by this package's own tests.
 *
 * It speaks just enough of the protocol to exercise the adapter: it listens on
 * a private unix socket / named pipe, completes the handshake, and records what
 * the adapter pushes. It is deliberately *not* exported from the package —
 * `@termwright/driver` is the real thing.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  createFrameDecoder,
  encodeFrame,
  parseAdapterMessage,
  generateToken,
  DEFAULT_LIMITS,
  PROTOCOL_ID,
  type AdapterToDriverMessage,
  type GetTreeResponse,
  type HelloMessage,
  type LogRecord,
  type ProtocolLimits,
  type SemanticSnapshot,
  type TreeDelta,
} from '@termwright/protocol';

/** Knobs for simulating driver behaviour the adapter must survive. */
export interface FakeDriverOptions {
  readonly sessionId?: string;
  readonly markerEnabled?: boolean;
  readonly subscribe?: 'snapshots' | 'revisions' | 'diffs';
  readonly limits?: ProtocolLimits;
  /** Reply to `hello` with a protocol error instead of an ack. */
  readonly rejectHandshake?: boolean;
  /** Destroy the connection abruptly after this many snapshots. */
  readonly dropAfterSnapshots?: number;
  /**
   * Log budget offered in `hello-ack`. Omitted entirely by default, which is
   * the protocol's way of saying logs are disabled.
   */
  readonly logs?: {
    readonly enabled: boolean;
    readonly maxRecordsPerSecond: number;
    readonly burst: number;
  };
}

/** A running fake driver. Always `close()` it, even when a test fails. */
export interface FakeDriver {
  readonly endpoint: string;
  readonly token: string;
  readonly sessionId: string;
  readonly hello: HelloMessage | undefined;
  readonly snapshots: readonly SemanticSnapshot[];
  readonly commits: readonly number[];
  readonly logs: readonly LogRecord[];
  /** Tree deltas, in arrival order, with the message envelope stripped. */
  readonly deltas: readonly TreeDelta[];
  /** Snapshots and deltas interleaved, so a test can assert what arrived when. */
  readonly treeTraffic: readonly ({ kind: 'snapshot' } | { kind: 'delta' })[];
  /** Resolve once `count` snapshots have arrived. */
  waitForSnapshots(count: number, timeoutMs?: number): Promise<readonly SemanticSnapshot[]>;
  /** Resolve once `count` tree messages (snapshot or delta) have arrived. */
  waitForTreeTraffic(count: number, timeoutMs?: number): Promise<number>;
  /** Resolve once `count` log records have arrived. */
  waitForLogs(count: number, timeoutMs?: number): Promise<readonly LogRecord[]>;
  /** Resolve once a connection has completed the handshake. */
  waitForHandshake(timeoutMs?: number): Promise<HelloMessage>;
  /** Issue a `get-tree` request and await the adapter's answer. */
  requestTree(revision?: number, timeoutMs?: number): Promise<GetTreeResponse>;
  /** Cut the connection without closing it politely. */
  cutConnection(): void;
  close(): Promise<void>;
}

/** Start a fake driver on a private endpoint. */
export async function startFakeDriver(options: FakeDriverOptions = {}): Promise<FakeDriver> {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-ink-'));
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\termwright-ink-${randomBytes(8).toString('hex')}`
      : join(directory, 'semantic.sock');
  const token = generateToken();
  const sessionId = options.sessionId ?? 's1';
  const limits = options.limits ?? DEFAULT_LIMITS;

  const snapshots: SemanticSnapshot[] = [];
  const commits: number[] = [];
  const logs: LogRecord[] = [];
  const deltas: TreeDelta[] = [];
  const treeTraffic: ({ kind: 'snapshot' } | { kind: 'delta' })[] = [];
  const responses = new Map<number, (response: GetTreeResponse) => void>();
  const waiters: Array<() => void> = [];
  let hello: HelloMessage | undefined;
  let connection: Socket | undefined;
  let nextRequestId = 1;

  const notify = (): void => {
    for (const waiter of waiters.splice(0)) waiter();
  };

  const server: Server = createServer((socket) => {
    connection = socket;
    socket.on('error', () => undefined);
    const decoder = createFrameDecoder(limits.maxFrameBytes);

    socket.on('data', (chunk: Buffer) => {
      let frames: readonly unknown[];
      try {
        frames = decoder.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const frame of frames) {
        const parsed = parseAdapterMessage(frame, limits);
        if (!parsed.ok) {
          socket.destroy();
          return;
        }
        handle(socket, parsed.message);
      }
    });
  });

  function handle(socket: Socket, message: AdapterToDriverMessage): void {
    switch (message.type) {
      case 'hello': {
        hello = message;
        if (options.rejectHandshake === true) {
          write(socket, { type: 'error', code: 'bad-token', message: 'rejected' });
          socket.destroy();
          notify();
          return;
        }
        write(socket, {
          type: 'hello-ack',
          protocol: PROTOCOL_ID,
          sessionId,
          limits,
          subscribe: options.subscribe ?? 'snapshots',
          marker: { enabled: options.markerEnabled ?? true },
          ...(options.logs === undefined ? {} : { logs: options.logs }),
        });
        notify();
        return;
      }
      case 'tree-delta': {
        const { type: _type, ...delta } = message;
        deltas.push(delta);
        treeTraffic.push({ kind: 'delta' });
        notify();
        return;
      }
      case 'snapshot': {
        snapshots.push(message.snapshot);
        treeTraffic.push({ kind: 'snapshot' });
        notify();
        if (
          options.dropAfterSnapshots !== undefined &&
          snapshots.length >= options.dropAfterSnapshots
        ) {
          socket.destroy();
        }
        return;
      }
      case 'log': {
        logs.push(message.record);
        notify();
        return;
      }
      case 'revision-commit': {
        commits.push(message.revision);
        notify();
        return;
      }
      case 'get-tree-result': {
        responses.get(message.requestId)?.(message);
        responses.delete(message.requestId);
        return;
      }
      default:
        return;
    }
  }

  function write(socket: Socket, message: unknown): void {
    try {
      socket.write(encodeFrame(message, limits.maxFrameBytes));
    } catch {
      socket.destroy();
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const until = async (predicate: () => boolean, timeoutMs: number, what: string): Promise<void> => {
    if (predicate()) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`fake driver: timed out waiting for ${what}`)), timeoutMs);
      const check = (): void => {
        if (!predicate()) {
          waiters.push(check);
          return;
        }
        clearTimeout(timer);
        resolve();
      };
      waiters.push(check);
    });
  };

  return {
    endpoint,
    token,
    sessionId,
    get hello() {
      return hello;
    },
    get snapshots() {
      return snapshots;
    },
    get commits() {
      return commits;
    },
    get logs() {
      return logs;
    },
    get deltas() {
      return deltas;
    },
    get treeTraffic() {
      return treeTraffic;
    },
    async waitForSnapshots(count, timeoutMs = 5_000) {
      await until(() => snapshots.length >= count, timeoutMs, `${count} snapshot(s)`);
      return snapshots;
    },
    async waitForTreeTraffic(count, timeoutMs = 5_000) {
      await until(() => treeTraffic.length >= count, timeoutMs, `${count} tree message(s)`);
      return treeTraffic.length;
    },
    async waitForLogs(count, timeoutMs = 5_000) {
      await until(() => logs.length >= count, timeoutMs, `${count} log record(s)`);
      return logs;
    },
    async waitForHandshake(timeoutMs = 5_000) {
      await until(() => hello !== undefined, timeoutMs, 'handshake');
      return hello as HelloMessage;
    },
    async requestTree(revision, timeoutMs = 5_000) {
      const socket = connection;
      if (socket === undefined) throw new Error('fake driver: no connection');
      const requestId = nextRequestId++;
      const answer = new Promise<GetTreeResponse>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('fake driver: get-tree timed out')), timeoutMs);
        responses.set(requestId, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
      });
      write(socket, {
        type: 'get-tree',
        requestId,
        ...(revision === undefined ? {} : { revision }),
      });
      return answer;
    },
    cutConnection() {
      connection?.destroy();
    },
    async close() {
      connection?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
