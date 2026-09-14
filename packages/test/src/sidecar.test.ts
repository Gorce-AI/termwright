import { describe, expect, it } from 'vitest';
import { launchSidecar } from './sidecar.js';

describe('sidecars', () => {
  it('waits for fragmented readiness output and owns process shutdown', async () => {
    const sidecar = await launchSidecar({
      command: [
        process.execPath,
        '-e',
        "process.stdout.write('RE'); setTimeout(() => process.stdout.write('ADY\\n'), 10); setInterval(() => {}, 1000)",
      ],
      ready: { output: 'READY', stream: 'stdout' },
      readyTimeout: 1_000,
      shutdownTimeout: 500,
    });

    expect(sidecar.pid).toBeGreaterThan(0);
    expect(sidecar.stdout()).toContain('READY');
    await sidecar.close();
    await expect(sidecar.exit).resolves.toMatchObject({ code: null });
    await sidecar.close();
  });

  it('includes bounded stderr when a process exits before readiness', async () => {
    await expect(
      launchSidecar({
        command: [
          process.execPath,
          '-e',
          "process.stderr.write('cannot bind\\n'); process.exit(2)",
        ],
        ready: { output: 'READY' },
        readyTimeout: 1_000,
      }),
    ).rejects.toThrow(/exited before readiness[\s\S]*cannot bind/u);
  });

  it('aborts startup through the fixture signal and does not leave a child running', async () => {
    const controller = new AbortController();
    const launch = launchSidecar(
      {
        command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
        ready: { output: 'NEVER' },
        readyTimeout: 10_000,
        shutdownTimeout: 500,
      },
      { signal: controller.signal },
    );

    controller.abort(new Error('test timeout'));
    await expect(launch).rejects.toThrow('test timeout');
  });

  it('retains only the configured output tail', async () => {
    const sidecar = await launchSidecar({
      command: [
        process.execPath,
        '-e',
        "process.stdout.write('x'.repeat(4096) + 'READY'); setInterval(() => {}, 1000)",
      ],
      ready: { output: 'READY', stream: 'stdout' },
      maxOutputBytes: 128,
      shutdownTimeout: 500,
    });
    try {
      expect(Buffer.byteLength(sidecar.stdout())).toBeLessThanOrEqual(128);
      expect(sidecar.stdout()).toContain('READY');
    } finally {
      await sidecar.close();
    }
  });
});
