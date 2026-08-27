import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProbePeerOwner } from './probe-peer-owner.js';
import { rollbackProbeStart } from './probe-start-cleanup.js';
import { ProbeStartupTransaction } from './probe-startup.js';

class StubbornPeer {
  readonly closed: Promise<void>;
  destroyCalls = 0;
  pauseCalls = 0;
  resumeCalls = 0;
  readonly #closeListeners: Array<() => void> = [];
  readonly #resolveClosed: () => void;

  constructor() {
    let resolveClosed!: () => void;
    this.closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    this.#resolveClosed = resolveClosed;
  }

  on(event: 'error', _listener: () => void): this {
    expect(event).toBe('error');
    return this;
  }

  once(event: 'close', listener: () => void): this {
    expect(event).toBe('close');
    this.#closeListeners.push(listener);
    return this;
  }

  destroy(): this {
    this.destroyCalls += 1;
    if (this.destroyCalls !== 1) return this;
    queueMicrotask(() => {
      for (const listener of this.#closeListeners) listener();
      this.#resolveClosed();
    });
    return this;
  }

  pause(): this {
    this.pauseCalls += 1;
    return this;
  }

  resume(): this {
    this.resumeCalls += 1;
    return this;
  }
}

describe('AdapterProbe peer shutdown', () => {
  it('owns peers before activation, rejects late peers, and shares one close barrier', async () => {
    const owner = new ProbePeerOwner();
    const acceptedBeforeActivation = new StubbornPeer();
    const acceptedWhileClosing = new StubbornPeer();
    const delivered: StubbornPeer[] = [];

    // The listener exists before the child is spawned. A child that connects
    // before AdapterProbe itself exists is owned immediately and delivered
    // once the protocol handler becomes available.
    expect(owner.admit(acceptedBeforeActivation)).toBe(true);
    expect(acceptedBeforeActivation.pauseCalls).toBe(1);
    expect(delivered).toEqual([]);
    owner.activate((socket) => delivered.push(socket as StubbornPeer));
    expect(delivered).toEqual([acceptedBeforeActivation]);
    expect(acceptedBeforeActivation.resumeCalls).toBe(1);

    let closeCalls = 0;
    let finishServerClose: (() => void) | undefined;
    const server = {
      close(callback: (error?: Error) => void): void {
        closeCalls += 1;
        // Models a connection already accepted by the OS whose JavaScript
        // callback becomes runnable while server.close() closes admission.
        expect(owner.admit(acceptedWhileClosing)).toBe(false);
        finishServerClose = () => callback();
      },
    };

    const first = owner.close(server);
    const concurrent = owner.close(server);

    expect(concurrent).toBe(first);
    expect(closeCalls).toBe(1);
    expect(acceptedBeforeActivation.destroyCalls).toBeGreaterThan(0);
    expect(acceptedWhileClosing.destroyCalls).toBeGreaterThan(0);
    finishServerClose?.();
    await first;
  });

  it('does not deliver a peer that closes before protocol activation', async () => {
    const owner = new ProbePeerOwner();
    const closedDuringStartup = new StubbornPeer();
    const delivered: StubbornPeer[] = [];

    expect(owner.admit(closedDuringStartup)).toBe(true);
    closedDuringStartup.destroy();
    await closedDuringStartup.closed;
    owner.activate((socket) => delivered.push(socket as StubbornPeer));

    expect(delivered).toEqual([]);
    expect(closedDuringStartup.resumeCalls).toBe(0);
  });

  it('rolls back every startup resource before preserving the primary failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-probe-start-'));
    const debugFile = join(directory, 'adapter.log');
    await writeFile(debugFile, 'started');
    const primary = new Error('spawn failed');
    let admissionClosed = false;
    let ptyDisposed = false;

    await expect(
      rollbackProbeStart(primary, {
        closeAdmission: async () => {
          admissionClosed = true;
        },
        disposePty: () => {
          ptyDisposed = true;
        },
        directory,
        debugFile,
      }),
    ).rejects.toBe(primary);

    expect(admissionClosed).toBe(true);
    expect(ptyDisposed).toBe(true);
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('finishes independent startup cleanup after one cleanup operation fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-probe-start-'));
    const primary = new Error('construction failed');
    const closeFailure = new Error('server close failed');
    const disposeFailure = new Error('pty dispose failed');

    const failure = await rollbackProbeStart(primary, {
      closeAdmission: () => Promise.reject(closeFailure),
      disposePty: () => {
        throw disposeFailure;
      },
      directory,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({ cause: primary });
    expect((failure as AggregateError).errors).toEqual([primary, disposeFailure, closeFailure]);
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back a listening endpoint when acquisition rejects after creating its directory', async () => {
    const startup = new ProbeStartupTransaction();
    const primary = new Error('listen certification failed');

    const acquisitionFailure = await startup
      .acquireEndpoint(true, {
        allocateDirectory: true,
        listen: async (server, endpoint) => {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(endpoint, resolve);
          });
          throw primary;
        },
      })
      .catch((error: unknown) => error);

    expect(acquisitionFailure).toBe(primary);
    expect(startup.server?.listening).toBe(true);
    const directory = startup.directory;
    expect(directory).not.toBeNull();
    await expect(startup.rollback(acquisitionFailure)).rejects.toBe(primary);
    expect(startup.server?.listening).toBe(false);
    await expect(access(directory as string)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
