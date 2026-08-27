interface OwnedSocket {
  destroy(): unknown;
  on(event: 'error', listener: () => void): unknown;
  once(event: 'close', listener: () => void): unknown;
  pause(): unknown;
  resume(): unknown;
}

interface ClosableServer {
  close(callback: (error?: Error) => void): unknown;
}

/** Owns accepted peers across listener startup and causal shutdown. */
export class ProbePeerOwner {
  readonly #sockets = new Set<OwnedSocket>();
  readonly #pending: OwnedSocket[] = [];
  #handler: ((socket: OwnedSocket) => void) | null = null;
  #closing = false;
  #closePromise: Promise<void> | null = null;

  admit(socket: OwnedSocket): boolean {
    socket.pause();
    this.#sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => {
      this.#sockets.delete(socket);
      const pending = this.#pending.indexOf(socket);
      if (pending >= 0) this.#pending.splice(pending, 1);
    });
    if (this.#closing) {
      socket.destroy();
      return false;
    }
    if (this.#handler === null) this.#pending.push(socket);
    else this.#deliver(socket);
    return true;
  }

  activate(handler: (socket: OwnedSocket) => void): void {
    if (this.#handler !== null) throw new Error('probe peer owner is already active');
    this.#handler = handler;
    for (const socket of this.#pending.splice(0)) this.#deliver(socket);
  }

  close(server: ClosableServer): Promise<void> {
    this.#closePromise ??= this.#close(server);
    return this.#closePromise;
  }

  async #close(server: ClosableServer): Promise<void> {
    this.#closing = true;
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    this.#pending.length = 0;
    for (const socket of this.#sockets) socket.destroy();
    await closed;
  }

  #deliver(socket: OwnedSocket): void {
    this.#handler?.(socket);
    socket.resume();
  }
}
