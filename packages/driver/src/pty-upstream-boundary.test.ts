import { describe, expect, it } from 'vitest';
import { createNodePtyBackend } from './pty.js';
import { inheritedSpawnEnv } from './session.js';

describe('pinned node-pty write boundary', () => {
  it('uses the Termwright-owned byte queue in an installed-package-equivalent runtime', async () => {
    const proc = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', "process.stdin.setRawMode?.(true);process.stdin.once('data',()=>{process.stdout.write('accepted');process.exit(0)});process.stdin.resume()"],
      env: inheritedSpawnEnv(),
      columns: 40,
      rows: 4,
    });
    let output = '';
    let writeError: Error | undefined;
    proc.onData((data) => { output += Buffer.from(data).toString('utf8'); });
    proc.onWriteError?.((error) => { writeError = error; });
    proc.write(Buffer.from('x'));
    const status = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      let settled = false;
      let release = (): void => undefined;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        release();
        reject(new Error('PTY write boundary test timed out'));
      }, 5_000);
      release = proc.onExit((exit) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        release();
        resolve(exit);
      });
    });
    proc.dispose();

    expect(writeError).toBeUndefined();
    expect(status.code).toBe(0);
    expect(output).toContain('accepted');
    expect(proc.lifecycle?.outputDrain).toBe('bounded-fallback');
  });
});
