import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { RunnerClient, RunnerControlError } from '../browser-client.js';
import { FakeHarness } from '../__fixtures__/fake-session.js';
import { startUiServer, type UiServer } from '../server.js';

const servers: UiServer[] = [];
const clients: RunnerClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.close();
  vi.unstubAllGlobals();
});

describe('RunnerClient input acknowledgements', () => {
  it('resolves only after the server write and preserves input order', async () => {
    const server = await startUiServer();
    servers.push(server);
    const harness = new FakeHarness('input-session');
    const writes: string[] = [];
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const detach = server.attach({
      source: harness.asHarness(),
      async write(bytes) {
        writes.push(new TextDecoder().decode(bytes));
        if (writes.length === 1) await firstWrite;
      },
    });

    const client = await connectClient(server);
    const first = client.sendInput('input-session', 'a');
    const second = client.sendInput('input-session', 'b');

    await until(() => writes.length === 1);
    expect(writes).toEqual(['a']);
    let firstSettled = false;
    let secondSettled = false;
    void first.then(() => {
      firstSettled = true;
    });
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    releaseFirst();
    await Promise.all([first, second]);
    expect(writes).toEqual(['a', 'b']);
    detach();
  });

  it('rejects the production call with the server write failure', async () => {
    const server = await startUiServer();
    servers.push(server);
    const harness = new FakeHarness('rejected-session');
    const detach = server.attach({
      source: harness.asHarness(),
      async write() {
        throw new Error('input device closed');
      },
    });

    const client = await connectClient(server);
    const failure = await client
      .sendInput('rejected-session', 'x')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RunnerControlError);
    expect(failure).toMatchObject({ kind: 'rejected', message: 'input device closed' });
    detach();
  });

  it('continues the ordered queue after one definitively rejected input', async () => {
    const server = await startUiServer();
    servers.push(server);
    const harness = new FakeHarness('recovering-session');
    const writes: string[] = [];
    const detach = server.attach({
      source: harness.asHarness(),
      async write(bytes) {
        const value = new TextDecoder().decode(bytes);
        writes.push(value);
        if (value === 'a') throw new Error('first input rejected');
      },
    });

    const client = await connectClient(server);
    const rejected = client.sendInput('recovering-session', 'a');
    const accepted = client.sendInput('recovering-session', 'b');
    await expect(rejected).rejects.toThrow('first input rejected');
    await expect(accepted).resolves.toBeUndefined();
    expect(writes).toEqual(['a', 'b']);
    detach();
  });

  it('ignores the stale close event when explicitly reconnecting', async () => {
    const server = await startUiServer();
    servers.push(server);
    const harness = new FakeHarness('reconnected-session');
    let releaseWrite!: () => void;
    const writeBarrier = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let writeStarted = false;
    const detach = server.attach({
      source: harness.asHarness(),
      async write() {
        writeStarted = true;
        await writeBarrier;
      },
    });

    const client = await connectClient(server);
    client.disconnect();
    await connect(client);
    const delivery = client.sendInput('reconnected-session', 'x');
    await until(() => writeStarted);
    // The server-side client count is the causal acknowledgement that the old
    // socket's close handler ran while the replacement request stayed pending.
    await until(() => server.hub.clientCount === 1);
    releaseWrite();
    await expect(delivery).resolves.toBeUndefined();
    detach();
  });
});

async function connectClient(server: UiServer): Promise<RunnerClient> {
  vi.stubGlobal('WebSocket', WebSocket);
  vi.stubGlobal('location', new URL(server.url));
  const client = new RunnerClient(server.token);
  clients.push(client);
  await connect(client);
  return client;
}

async function connect(client: RunnerClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RunnerClient did not connect')), 2_000);
    client.connect(
      () => undefined,
      (connected) => {
        if (!connected) return;
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition did not become true');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
