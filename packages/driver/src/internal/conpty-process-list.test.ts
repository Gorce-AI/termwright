import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { enumerateConptyProcesses } from './conpty-process-list.js';

class ControlledHelper extends EventEmitter {
  constructor(readonly pid: number | undefined = 900) {
    super();
  }
  killCount = 0;
  kill(): boolean {
    this.killCount += 1;
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  }
}

describe('owned ConPTY process-list helper', () => {
  it('removes the observer PID and publishes evidence only after that helper exits', async () => {
    const helper = new ControlledHelper();
    let settled = false;
    const operation = enumerateConptyProcesses(42, new AbortController().signal, () => helper)
      .then((value) => { settled = true; return value; });

    helper.emit('message', { consoleProcessList: [42, helper.pid, 43] });
    await Promise.resolve();
    expect(settled).toBe(false);
    helper.emit('exit', 0, null);
    await expect(operation).resolves.toEqual([42, 43]);
    expect(helper.listenerCount('message')).toBe(0);
    expect(helper.listenerCount('exit')).toBe(0);
  });

  it('kills and drains a never-answering helper when cancelled', async () => {
    const helper = new ControlledHelper();
    const controller = new AbortController();
    const reason = new Error('caller deadline');
    const operation = enumerateConptyProcesses(42, controller.signal, () => helper);

    controller.abort(reason);
    await expect(operation).rejects.toBe(reason);
    expect(helper.killCount).toBe(1);
    expect(helper.listenerCount('message')).toBe(0);
    expect(helper.listenerCount('exit')).toBe(0);
  });

  it('fails closed when the helper exits without process-list evidence', async () => {
    const helper = new ControlledHelper();
    const operation = enumerateConptyProcesses(42, new AbortController().signal, () => helper);
    helper.emit('exit', 1, null);
    await expect(operation).rejects.toThrow('exited without evidence');
  });

  it('kills and rejects a helper that sends malformed evidence', async () => {
    const helper = new ControlledHelper();
    const operation = enumerateConptyProcesses(42, new AbortController().signal, () => helper);
    helper.emit('message', { consoleProcessList: ['not-a-pid'] });
    await expect(operation).rejects.toThrow('invalid message');
    expect(helper.killCount).toBe(1);
  });

  it('fails closed when the observer PID cannot be excluded from evidence', async () => {
    const helper = new ControlledHelper();
    Object.defineProperty(helper, 'pid', { value: undefined });
    await expect(enumerateConptyProcesses(42, new AbortController().signal, () => helper))
      .rejects.toThrow('did not expose its observer PID');
    expect(helper.killCount).toBe(1);
  });
});
