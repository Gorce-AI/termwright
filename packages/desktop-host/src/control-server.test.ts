import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { withinDeadline } from './deadline.js';
import { bindControlServer } from './control-server.js';

class DelayedBindServer extends EventEmitter {
  readonly closeStates: boolean[] = [];
  listening = false;
  private listenCallback: (() => void) | undefined;

  listen(_address: string, callback: () => void): this {
    this.listenCallback = callback;
    return this;
  }

  close(callback: (error?: Error) => void): this {
    this.closeStates.push(this.listening);
    if (!this.listening) {
      const error = Object.assign(new Error('server is not running'), { code: 'ERR_SERVER_NOT_RUNNING' });
      callback(error);
      return this;
    }
    this.listening = false;
    callback();
    return this;
  }

  completeLateBind(): void {
    this.listening = true;
    this.listenCallback?.();
  }
}

describe('control server bind ownership', () => {
  it('closes a listener whose bind callback arrives after deadline cancellation', async () => {
    const server = new DelayedBindServer();
    const bind = bindControlServer(server, 'delayed-address');

    await expect(withinDeadline(bind, performance.now() - 1, 'bind deadline expired'))
      .rejects.toThrow('bind deadline expired');
    const rolledBack = bind.rollback();
    expect(server.closeStates).toEqual([false]);

    server.completeLateBind();
    await rolledBack;

    expect(server.closeStates).toEqual([false, true]);
    expect(server.listening).toBe(false);
    expect(server.listenerCount('error')).toBe(0);
  });
});
