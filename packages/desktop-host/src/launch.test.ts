import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchDesktopHost } from './index.js';

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

describe('desktop host launcher', () => {
  it('bootstraps over private file descriptors and shuts the host down', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'termwright-desktop-host-'));
    const fake = join(cwd, 'fake-host.mjs');
    const observed = join(cwd, 'observed.json');
    await writeFile(fake, [
      "import { writeFileSync } from 'node:fs';",
      `const observed = ${JSON.stringify(observed)};`,
      "import { connect } from 'node:net';",
      "const address = process.env.TERMWRIGHT_DESKTOP_CONTROL; delete process.env.TERMWRIGHT_DESKTOP_CONTROL;",
      "const input = connect(address); input.setEncoding('utf8');",
      "const output = input;",
      "let buffer = '';",
      "input.on('data', chunk => {",
      "  buffer += chunk;",
      "  for (;;) {",
      "    const newline = buffer.indexOf('\\n');",
      "    if (newline < 0) break;",
      "    const message = JSON.parse(buffer.slice(0, newline));",
      "    buffer = buffer.slice(newline + 1);",
      "    if (message.type === 'bootstrap') {",
      "      writeFileSync(observed, JSON.stringify({ argv: process.argv, env: process.env, bootstrap: message }));",
      "      output.write(JSON.stringify({ protocol: 1, type: 'ready' }) + '\\n');",
      "    } else if (message.type === 'shutdown') {",
      "      output.write(JSON.stringify({ protocol: 1, type: 'closed' }) + '\\n');",
      "      process.exit(0);",
      "    }",
      "  }",
      "});",
    ].join('\n'));

    try {
      const url = 'http://127.0.0.1:4567/?token=private-value';
      const handle = await launchDesktopHost({
        url,
        executable: process.execPath,
        main: fake,
        readyTimeoutMs: 2_000,
      });
      const state = JSON.parse(await readFile(observed, 'utf8')) as {
        argv: string[];
        env: Record<string, string>;
        bootstrap: { url: string };
      };
      expect(state.bootstrap.url).toBe(url);
      expect(JSON.stringify(state.argv)).not.toContain('private-value');
      expect(JSON.stringify(state.env)).not.toContain('private-value');
      const firstClose = handle.close();
      const secondClose = handle.close();
      expect(secondClose).toBe(firstClose);
      await firstClose;
      await expect(handle.closed).resolves.toBeUndefined();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('uses one readiness deadline across connection and ready phases', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'termwright-desktop-host-'));
    const fake = join(cwd, 'slow-host.mjs');
    const pidFile = join(cwd, 'pid');
    await writeFile(fake, [
      "import { writeFileSync } from 'node:fs';",
      "import { connect } from 'node:net';",
      `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      'setTimeout(() => {',
      '  const socket = connect(process.env.TERMWRIGHT_DESKTOP_CONTROL);',
      "  socket.setEncoding('utf8');",
      "  socket.on('data', () => setTimeout(() => socket.write(JSON.stringify({ protocol: 1, type: 'ready' }) + '\\n'), 60));",
      '}, 60);',
      'setInterval(() => undefined, 1_000);',
    ].join('\n'));
    try {
      await expect(launchDesktopHost({
        url: 'http://127.0.0.1:4567/?token=private-value',
        executable: process.execPath,
        main: fake,
        readyTimeoutMs: 100,
      })).rejects.toThrow(/did not become ready|did not connect/u);
      const pid = Number(await readFile(pidFile, 'utf8'));
      expect(processAlive(pid)).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('reaps a child that never connects before rejecting startup', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'termwright-desktop-host-'));
    const fake = join(cwd, 'detached-host.mjs');
    const pidFile = join(cwd, 'pid');
    await writeFile(fake, [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      'setInterval(() => undefined, 1_000);',
    ].join('\n'));
    try {
      await expect(launchDesktopHost({
        url: 'http://127.0.0.1:4567/?token=private-value',
        executable: process.execPath,
        main: fake,
        readyTimeoutMs: 100,
      })).rejects.toThrow('did not connect');
      const pid = Number(await readFile(pidFile, 'utf8'));
      expect(processAlive(pid)).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
