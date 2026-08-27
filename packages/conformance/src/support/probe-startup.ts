import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PtyProcess } from '@termwright/driver/experimental';
import { ProbePeerOwner } from './probe-peer-owner.js';
import { rollbackProbeStart } from './probe-start-cleanup.js';

export type ProbeListen = (server: Server, endpoint: string) => Promise<void>;

export interface ProbeEndpointAcquisition {
  readonly listen?: ProbeListen;
  /** Exercises directory ownership on named-pipe hosts in the transaction test. */
  readonly allocateDirectory?: boolean;
}

/** Mutable ownership boundary for every resource acquired during probe startup. */
export class ProbeStartupTransaction {
  readonly peers = new ProbePeerOwner();
  server: Server | null = null;
  directory: string | null = null;
  endpoint: string | null = null;
  debugFile: string | null = null;
  pty: PtyProcess | null = null;

  async acquireEndpoint(
    instrument: boolean,
    options: ProbeEndpointAcquisition = {},
  ): Promise<void> {
    if (!instrument) return;
    this.server = createServer();
    this.server.on('connection', (socket) => this.peers.admit(socket));
    if (process.platform !== 'win32' || options.allocateDirectory === true) {
      this.directory = await mkdtemp(join(tmpdir(), 'termwright-probe-'));
    }
    if (process.platform === 'win32') {
      this.endpoint = `\\\\.\\pipe\\termwright-probe-${randomBytes(16).toString('hex')}`;
    } else {
      this.endpoint = join(this.directory as string, 'semantic.sock');
    }
    await (options.listen ?? listenServer)(this.server, this.endpoint);
  }

  rollback(primary: unknown): Promise<never> {
    const server = this.server;
    const pty = this.pty;
    return rollbackProbeStart(primary, {
      ...(server === null || !server.listening
        ? {}
        : { closeAdmission: () => this.peers.close(server) }),
      ...(pty === null ? {} : { disposePty: () => pty.dispose() }),
      directory: this.directory,
      debugFile: this.debugFile,
    });
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
