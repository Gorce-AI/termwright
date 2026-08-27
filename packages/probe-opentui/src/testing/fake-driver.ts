/**
 * A driver stand-in for this package's own tests.
 *
 * Speaks just enough of the protocol to complete a handshake and record what a
 * probe pushes. Every frame is validated with `parseAdapterMessage`, so a test
 * that goes green here went green against real validation rather than a mock of
 * it — and a refusal is kept and reported, because a rejected frame otherwise
 * shows up as a bare timeout with nothing saying why.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  createFrameDecoder,
  encodeFrame,
  generateToken,
  parseAdapterMessage,
  DEFAULT_LIMITS,
  PROTOCOL_ID,
  type HelloMessage,
  type ProtocolErrorMessage,
  type SemanticSnapshot,
} from '@termwright/protocol';

/** Default wait, below Vitest's 5 s so the informative message wins the race. */
const DEFAULT_WAIT_MS = 4_000;

/** A running fake driver. Always `close()` it. */
export interface FakeDriver {
  readonly endpoint: string;
  readonly token: string;
  readonly sessionId: string;
  readonly hello: HelloMessage | undefined;
  readonly snapshots: readonly SemanticSnapshot[];
  readonly errors: readonly ProtocolErrorMessage[];
  waitForSnapshots(count: number, timeoutMs?: number): Promise<readonly SemanticSnapshot[]>;
  waitForSnapshot(
    predicate: (snapshot: SemanticSnapshot) => boolean,
    description: string,
    timeoutMs?: number,
  ): Promise<SemanticSnapshot>;
  waitForHandshake(timeoutMs?: number): Promise<HelloMessage>;
  close(): Promise<void>;
}

/** Start one on a private endpoint. */
export async function startFakeDriver(): Promise<FakeDriver> {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-probe-driver-'));
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\termwright-probe-${randomBytes(8).toString('hex')}`
      : join(directory, 'semantic.sock');
  const token = generateToken();
  const sessionId = 's1';
  const limits = DEFAULT_LIMITS;

  const snapshots: SemanticSnapshot[] = [];
  const errors: ProtocolErrorMessage[] = [];
  const waiters: (() => void)[] = [];
  let hello: HelloMessage | undefined;
  let rejection: string | undefined;
  let connection: Socket | undefined;

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
          rejection ??= `${parsed.code}: ${parsed.detail}`;
          socket.destroy();
          notify();
          return;
        }
        const message = parsed.message;
        if (message.type === 'hello') {
          hello = message;
          try {
            socket.write(
              encodeFrame(
                {
                  type: 'hello-ack',
                  protocol: PROTOCOL_ID,
                  sessionId,
                  limits,
                  subscribe: 'snapshots',
                  marker: { enabled: true },
                },
                limits.maxFrameBytes,
              ),
            );
          } catch {
            socket.destroy();
          }
          notify();
        } else if (message.type === 'snapshot') {
          snapshots.push(message.snapshot);
          notify();
        } else if (message.type === 'error') {
          errors.push(message);
          notify();
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const until = async (
    predicate: () => boolean,
    timeoutMs: number,
    what: string,
  ): Promise<void> => {
    if (predicate()) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const because =
          rejection === undefined ? '' : `; the driver refused a frame — ${rejection}`;
        reject(new Error(`fake driver: timed out waiting for ${what}${because}`));
      }, timeoutMs);
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
    get errors() {
      return errors;
    },
    async waitForSnapshots(count, timeoutMs = DEFAULT_WAIT_MS) {
      await until(() => snapshots.length >= count, timeoutMs, `${count} snapshot(s)`);
      return snapshots;
    },
    async waitForSnapshot(predicate, description, timeoutMs = DEFAULT_WAIT_MS) {
      let observed: SemanticSnapshot | undefined;
      await until(
        () => {
          observed = snapshots.find(predicate);
          return observed !== undefined;
        },
        timeoutMs,
        description,
      );
      return observed as SemanticSnapshot;
    },
    async waitForHandshake(timeoutMs = DEFAULT_WAIT_MS) {
      await until(() => hello !== undefined, timeoutMs, 'handshake');
      return hello as HelloMessage;
    },
    async close() {
      connection?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
