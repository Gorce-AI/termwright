import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LogTailer } from './logs.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('LogTailer final drain', () => {
  it('cancels its scheduler and refuses a queued poll after stop', async () => {
    const root = mkdtempSync(join(tmpdir(), 'termwright-log-stop-'));
    roots.push(root);
    const path = join(root, 'app.log');
    writeFileSync(path, 'old run\n');
    const lines: string[] = [];
    let scheduled: (() => Promise<void>) | undefined;
    let cancelled = false;
    const tailer = new LogTailer(
      [{ path }],
      {
        onLine: (_source, line) => lines.push(line),
        onDiagnostic: () => undefined,
      },
      (poll) => {
        scheduled = poll;
        return () => { cancelled = true; };
      },
    );
    await tailer.start();
    await tailer.stop();

    appendFileSync(path, 'written after stop\n');
    await scheduled?.();

    expect(cancelled).toBe(true);
    expect(lines).toEqual([]);
  });

  it('delivers a complete record appended immediately before stop', async () => {
    const root = mkdtempSync(join(tmpdir(), 'termwright-log-final-'));
    roots.push(root);
    const path = join(root, 'app.log');
    writeFileSync(path, 'old run\n');
    const lines: string[] = [];
    const tailer = new LogTailer([{ path }], {
      onLine: (_source, line) => lines.push(line),
      onDiagnostic: () => undefined,
    });
    await tailer.start();

    appendFileSync(path, 'ERROR at process exit\n');
    await tailer.stop();

    expect(lines).toEqual(['ERROR at process exit']);
  });

  it('drains bursts larger than one read tick before closing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'termwright-log-burst-'));
    roots.push(root);
    const path = join(root, 'app.log');
    writeFileSync(path, '');
    const lines: string[] = [];
    const tailer = new LogTailer([{ path }], {
      onLine: (_source, line) => lines.push(line),
      onDiagnostic: () => undefined,
    });
    await tailer.start();
    const records = Array.from({ length: 200 }, (_, index) => `${index}:${'x'.repeat(400)}`);
    appendFileSync(path, `${records.join('\n')}\n`);

    await tailer.stop();

    expect(lines).toEqual(records);
  });
});
