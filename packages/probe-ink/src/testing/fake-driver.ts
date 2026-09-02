/** Small validating driver used by the process-level zero-config suite. */

import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySemanticDelta,
  createFrameDecoder,
  encodeFrame,
  generateToken,
  parseAdapterMessage,
  DEFAULT_LIMITS,
  type HelloMessage,
  type SemanticSnapshot,
} from '@termwright/protocol';

// Full real-process conformance intentionally runs several Node, Bun, Go and
// Rust fixtures in parallel. This is only the test driver's observation
// ceiling (not the product negotiation window), so leave enough scheduler
// headroom to diagnose a real rejection instead of producing a load flake.
const DEFAULT_WAIT_MS = 10_000;

export interface FakeDriver {
  readonly endpoint: string;
  readonly token: string;
  readonly sessionId: string;
  readonly snapshots: readonly SemanticSnapshot[];
  waitForSnapshots(count: number, timeoutMs?: number): Promise<readonly SemanticSnapshot[]>;
  waitForHandshake(timeoutMs?: number): Promise<HelloMessage>;
  close(): Promise<void>;
}

export async function startFakeDriver(): Promise<FakeDriver> {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-ink-driver-'));
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\termwright-ink-${randomBytes(8).toString('hex')}`
      : join(directory, 'semantic.sock');
  const token = generateToken();
  const sessionId = 'ink-session';
  const snapshots: SemanticSnapshot[] = [];
  const waiters: (() => void)[] = [];
  let hello: HelloMessage | undefined;
  let rejection: string | undefined;
  let connection: Socket | undefined;
  let currentSnapshot: SemanticSnapshot | undefined;

  const notify = (): void => {
    for (const waiter of waiters.splice(0)) waiter();
  };

  const server: Server = createServer((socket) => {
    connection = socket;
    socket.on('error', () => undefined);
    const decoder = createFrameDecoder(DEFAULT_LIMITS.maxFrameBytes);
    socket.on('data', (chunk: Buffer) => {
      let values: readonly unknown[];
      try {
        values = decoder.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const value of values) {
        const parsed = parseAdapterMessage(value, DEFAULT_LIMITS);
        if (!parsed.ok) {
          rejection = `${parsed.code}: ${parsed.detail}`;
          socket.destroy();
          notify();
          return;
        }
        const message = parsed.message;
        if (message.type === 'hello') {
          hello = message;
          socket.write(
            encodeFrame(
              {
                type: 'hello-ack',
                protocol: message.protocol,
                sessionId,
                limits: DEFAULT_LIMITS,
                subscribe: 'semantic',
                marker: { enabled: true },
              },
              DEFAULT_LIMITS.maxFrameBytes,
            ),
          );
          notify();
        } else if (message.type === 'semantic-full') {
          currentSnapshot = message.snapshot;
          snapshots.push(message.snapshot);
          notify();
        } else if (message.type === 'semantic-delta') {
          if (currentSnapshot === undefined) {
            rejection = 'semantic delta arrived before a full base snapshot';
            socket.write(
              encodeFrame(
                {
                  type: 'semantic-resync-request',
                  sessionId,
                  expectedBaseRevision: null,
                  reason: 'missing-base',
                },
                DEFAULT_LIMITS.maxFrameBytes,
              ),
            );
            notify();
            continue;
          }
          const applied = applySemanticDelta(currentSnapshot, message.delta, DEFAULT_LIMITS);
          if (!applied.ok) {
            rejection = `${applied.code}: ${applied.detail}`;
            if (applied.resyncRequired) {
              socket.write(
                encodeFrame(
                  {
                    type: 'semantic-resync-request',
                    sessionId,
                    expectedBaseRevision: currentSnapshot.revision,
                    reason: 'base-mismatch',
                  },
                  DEFAULT_LIMITS.maxFrameBytes,
                ),
              );
            } else {
              socket.destroy();
            }
            notify();
            continue;
          }
          currentSnapshot = applied.snapshot;
          snapshots.push(currentSnapshot);
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
        reject(
          new Error(
            `fake Ink driver: timed out waiting for ${what}` +
              (rejection === undefined ? '' : `; rejected ${rejection}`),
          ),
        );
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
    get snapshots() {
      return snapshots;
    },
    async waitForSnapshots(count, timeoutMs = DEFAULT_WAIT_MS) {
      await until(() => snapshots.length >= count, timeoutMs, `${count} snapshot(s)`);
      return snapshots;
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
