import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import { candidatePaths, spawnPty } from './index.js';

const it = resourceAwareIt.resources({ terminals: 1, traceWriters: 0 });
const nativePressureIt = resourceAwareIt.resources({
  terminals: 1,
  traceWriters: 0,
  nativeHost: 'exclusive',
});

const environment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

function node(source: string): readonly string[] {
  return [process.execPath, '-e', source];
}

function collect(command: readonly string[]) {
  const handle = spawnPty({ command, env: environment(), columns: 80, rows: 24 });
  const chunks: Buffer[] = [];
  handle.onData((data) => chunks.push(Buffer.from(data)));
  const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    handle.onExit(resolve);
  });
  return {
    handle,
    chunks,
    exit,
    text: (): string => Buffer.concat(chunks).toString('utf8'),
  };
}

function waitForText(
  handle: ReturnType<typeof spawnPty>,
  chunks: Buffer[],
  marker: string,
): Promise<void> {
  if (Buffer.concat(chunks).includes(marker)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const releases: Array<() => void> = [];
    const settle = (outcome: () => void): void => {
      for (const release of releases.splice(0)) release();
      outcome();
    };
    releases.push(
      handle.onData(() => {
        if (!Buffer.concat(chunks).includes(marker)) return;
        settle(resolve);
      }),
    );
    releases.push(
      handle.onExit((status) =>
        settle(() =>
          reject(
            new Error(
              `PTY exited before ${JSON.stringify(marker)}: ${JSON.stringify(status)}; saw ${JSON.stringify(Buffer.concat(chunks).toString('utf8'))}`,
            ),
          ),
        ),
      ),
    );
    releases.push(handle.onError((error) => settle(() => reject(error))));
  });
}

describe.skipIf(process.platform === 'win32')('the Termwright-owned POSIX PTY', () => {
  it('loads the local addon before the platform prebuild', () => {
    expect(candidatePaths('darwin', 'arm64')).toEqual([
      '../build/Release/termwright_pty.node',
      '@termwright/pty-darwin-arm64/termwright_pty.node',
    ]);
  });

  it('resolves a bare executable from PATH without invoking a shell', async () => {
    const session = collect(['node', '-e', "process.stdout.write('BARE_EXECUTABLE')"]);
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(session.text()).toContain('BARE_EXECUTABLE');
    expect(session.handle.sawRealEof).toBe(true);
    session.handle.dispose();
  });

  it('fails before forking when a bare executable is absent from PATH', () => {
    expect(() =>
      spawnPty({
        command: ['termwright-command-that-does-not-exist'],
        env: { PATH: '/usr/bin:/bin' },
        columns: 80,
        rows: 24,
      }),
    ).toThrow(/executable not found on PATH/u);
  });

  it('delivers a megabyte tail and its sentinel before authoritative EOF', async () => {
    const payloadBytes = 1024 * 1024;
    const session = collect(
      node(
        [
          "const fs = require('node:fs');",
          `const block = Buffer.alloc(${payloadBytes}, 0x78);`,
          'let offset = 0;',
          'while (offset < block.length) offset += fs.writeSync(1, block, offset);',
          "fs.writeSync(1, Buffer.from('FINAL_SENTINEL'));",
        ].join(''),
      ),
    );

    const [status] = await Promise.all([session.exit, session.handle.outputEnded]);
    const output = Buffer.concat(session.chunks);
    expect(status).toEqual({ code: 0, signal: null });
    expect(session.handle.sawRealEof).toBe(true);
    expect(session.handle.endReason).toBe(0);
    expect(output.subarray(0, payloadBytes)).toEqual(Buffer.alloc(payloadBytes, 0x78));
    expect(output.subarray(payloadBytes).toString('utf8')).toBe('FINAL_SENTINEL');
    session.handle.dispose();
  });

  it('writes exact bytes through the owned master', async () => {
    const session = collect(
      node(
        [
          'process.stdin.setRawMode(true);',
          "process.stdin.once('data', data => {",
          "process.stdout.write('HEX=' + Buffer.from(data).toString('hex'));",
          'process.exit(0);',
          '});',
          'process.stdin.resume();',
          "process.stdout.write('READY');",
        ].join(''),
      ),
    );
    await waitForText(session.handle, session.chunks, 'READY');
    session.handle.write(Uint8Array.from([0, 0xff, 0x1b, 0x5b, 0x4d]));
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(session.text()).toContain('HEX=00ff1b5b4d');
    expect(session.handle.sawRealEof).toBe(true);
    session.handle.dispose();
  });

  nativePressureIt('does not lose a wake while many small writes race the writer', async () => {
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251));
    const session = collect(
      node(
        [
          'process.stdin.setRawMode(true);',
          'const chunks = []; let received = 0;',
          "process.stdin.on('data', chunk => {",
          'chunks.push(chunk); received += chunk.length;',
          `if (received === ${bytes.length}) {`,
          "process.stdout.write('HEX=' + Buffer.concat(chunks).toString('hex'));",
          'process.exit(0);',
          '}',
          '});',
          'process.stdin.resume();',
          "process.stdout.write('READY');",
        ].join(''),
      ),
    );
    try {
      await waitForText(session.handle, session.chunks, 'READY');
      for (const byte of bytes) session.handle.write(Uint8Array.of(byte));
      await Promise.all([session.exit, session.handle.outputEnded]);
      expect(session.text()).toContain(`HEX=${bytes.toString('hex')}`);
    } finally {
      session.handle.dispose();
    }
  });

  nativePressureIt(
    'keeps a backpressured write healthy when later input wakes its poll',
    async () => {
      const firstBytes = 1024 * 1024;
      const laterBytes = 64 * 1024;
      const totalBytes = firstBytes + laterBytes;
      const server = createServer();
      const controlConnected = new Promise<import('node:net').Socket>((resolve) => {
        server.once('connection', resolve);
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('backpressure control server has no TCP port');
      let session: ReturnType<typeof collect> | undefined;
      let control: import('node:net').Socket | undefined;
      try {
        session = collect(
          node(
            [
              "const net = require('node:net');",
              'process.stdin.setRawMode(true);',
              'process.stdin.pause();',
              'let received = 0; let ordered = true;',
              `const control = net.connect(${address.port}, '127.0.0.1', () => {`,
              "process.stdin.once('readable', () => process.stdout.write('INPUT_BUFFERED'));",
              "process.stdout.write('READY');",
              '});',
              "control.once('data', () => {",
              "process.stdin.on('data', chunk => {",
              'for (const byte of chunk) {',
              `const expected = received < ${firstBytes} ? 0x61 : 0x62;`,
              'if (byte !== expected) ordered = false; received += 1;',
              '}',
              `if (received === ${totalBytes}) {`,
              "process.stdout.write(ordered ? 'INPUT_ORDERED' : 'INPUT_REORDERED');",
              'process.exit(ordered ? 0 : 2);',
              '}',
              '});',
              'process.stdin.resume();',
              '});',
            ].join(''),
          ),
        );
        await waitForText(session.handle, session.chunks, 'READY');
        let drained = false;
        const drain = new Promise<void>((resolve, reject) => {
          const releases: Array<() => void> = [];
          const settle = (outcome: () => void): void => {
            for (const release of releases.splice(0)) release();
            outcome();
          };
          releases.push(
            session!.handle.onDrain(() => {
              drained = true;
              settle(resolve);
            }),
          );
          releases.push(session!.handle.onError((error) => settle(() => reject(error))));
          releases.push(
            session!.handle.onExit((status) =>
              settle(() =>
                reject(new Error(`PTY exited before input drain: ${JSON.stringify(status)}`)),
              ),
            ),
          );
        });
        session.handle.write(Buffer.alloc(firstBytes, 0x61));
        // `readable` proves that the PTY delivered some input. The paused Node
        // stream cannot absorb the remaining megabyte, so the native write is now
        // backpressured without relying on elapsed silence.
        await waitForText(session.handle, session.chunks, 'INPUT_BUFFERED');
        // Output and drain share the addon's ordered event channel. Observing
        // this child-produced marker proves that an admission-time drain would
        // already have run in JavaScript, while the PTY is demonstrably blocked.
        expect(drained).toBe(false);
        session.handle.write(Buffer.alloc(laterBytes, 0x62));
        control = await controlConnected;
        control.write('release');
        await Promise.all([drain, session.exit, session.handle.outputEnded]);
        expect(session.text()).toContain('INPUT_ORDERED');
        expect(session.handle.sawRealEof).toBe(true);
      } finally {
        session?.handle.dispose();
        control?.destroy();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        });
      }
    },
  );
});

describe('the Termwright-owned native PTY flow control', () => {
  nativePressureIt('bounds input admitted while the child does not consume it', async () => {
    const session = collect(
      node(
        ["require('node:net').createServer().listen(0);", "process.stdout.write('READY');"].join(
          '',
        ),
      ),
    );
    await waitForText(session.handle, session.chunks, 'READY');
    const block = Buffer.alloc(1024 * 1024, 0x61);
    expect(() => {
      for (let index = 0; index < 32; index += 1) session.handle.write(block);
    }).toThrow(/input queue capacity exceeded/u);
    session.handle.dispose();
  });

  it('keeps the child alive while admitted input and its drain complete', async () => {
    // One upstream ConPTY input read quantum is enough to prove both causal
    // edges. A larger ASCII write is not stronger evidence on Windows: unless
    // ENABLE_VIRTUAL_TERMINAL_INPUT is enabled, OpenConsole expands every byte
    // into key-down/key-up INPUT_RECORDs and turns the test into a benchmark of
    // console keyboard synthesis rather than of our native drain contract.
    const payload = Buffer.from('termwright-input-0123456789'.repeat(152)).subarray(0, 4096);
    const receipt = createHash('sha256').update(payload).digest('hex');
    const server = createServer();
    const controlConnected = new Promise<import('node:net').Socket>((resolve) => {
      server.once('connection', resolve);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    let session: ReturnType<typeof collect> | undefined;
    let control: import('node:net').Socket | undefined;
    try {
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('drain control server has no TCP port');
      session = collect(
        node(
          [
            "const net = require('node:net');",
            'process.stdin.setRawMode(true);',
            'process.stdin.resume();',
            "const { createHash } = require('node:crypto');",
            "const hash = createHash('sha256');",
            'let received = 0;',
            `const control = net.connect(${address.port}, '127.0.0.1', () => process.stdout.write('READY'));`,
            "control.once('data', () => control.end('BYE'));",
            "control.once('close', () => process.exit(0));",
            "process.stdin.on('data', chunk => {",
            'received += chunk.length;',
            'hash.update(chunk);',
            `if (received === ${payload.length}) process.stdout.write('INPUT_DRAINED:' + hash.digest('hex'));`,
            '});',
          ].join(''),
        ),
      );
      await waitForText(session.handle, session.chunks, 'READY');
      let drained = false;
      const drain = new Promise<void>((resolve, reject) => {
        const releases: Array<() => void> = [];
        const settle = (outcome: () => void): void => {
          for (const release of releases.splice(0)) release();
          outcome();
        };
        releases.push(
          session!.handle.onDrain(() => {
            drained = true;
            settle(resolve);
          }),
        );
        releases.push(session!.handle.onError((error) => settle(() => reject(error))));
        releases.push(
          session!.handle.onExit((status) =>
            settle(() =>
              reject(new Error(`PTY exited before input drain: ${JSON.stringify(status)}`)),
            ),
          ),
        );
      });
      session.handle.write(payload);
      expect(drained).toBe(false);
      await Promise.all([
        drain,
        waitForText(session.handle, session.chunks, `INPUT_DRAINED:${receipt}`),
      ]);
      control = await controlConnected;
      const controlClosed = new Promise<void>((resolve, reject) => {
        const reply: Buffer[] = [];
        control!.on('data', (data) => reply.push(data));
        control!.once('error', reject);
        control!.once('end', () => control!.end());
        control!.once('close', (hadError) => {
          if (hadError) return;
          const message = Buffer.concat(reply).toString();
          if (message === 'BYE') resolve();
          else reject(new Error(`unexpected drain-control farewell: ${JSON.stringify(message)}`));
        });
      });
      control.write('X');
      await Promise.all([controlClosed, session.exit, session.handle.outputEnded]);
    } finally {
      session?.handle.dispose();
      control?.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });

  it('rejects input after the authoritative output end', async () => {
    const session = collect(node("process.stdout.write('DONE')"));
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(() => session.handle.write(Buffer.from('late'))).toThrow(/input is closed/u);
    session.handle.dispose();
  });

  nativePressureIt(
    'delivers the final tail after a pressure burst through the bounded native-to-JS channel',
    async () => {
      const frameCount = 4096;
      const framePayloadBytes = 4096;
      const session = collect(
        node(
          [
            "const fs = require('node:fs');",
            `const payload = Buffer.alloc(${framePayloadBytes}, 0x71);`,
            `for (let index = 0; index < ${frameCount}; index += 1) {`,
            "fs.writeSync(1, Buffer.from('\\x1b]8486;TW_PRESSURE;' + index.toString(16).padStart(8, '0') + ';'));",
            'fs.writeSync(1, payload);',
            "fs.writeSync(1, Buffer.from('\\x07'));",
            '}',
            "fs.writeSync(1, Buffer.from('PRESSURE_SENTINEL'));",
          ].join(''),
        ),
      );
      await Promise.all([session.exit, session.handle.outputEnded]);
      const output = Buffer.concat(session.chunks);
      const prefix = Buffer.from('\x1b]8486;TW_PRESSURE;');
      const sentinel = Buffer.from('PRESSURE_SENTINEL');
      let cursor = 0;
      for (let index = 0; index < frameCount; index += 1) {
        const start = output.indexOf(prefix, cursor);
        if (process.platform === 'win32') expect(start).toBeGreaterThanOrEqual(cursor);
        else expect(start).toBe(cursor);
        const end = output.indexOf(0x07, start + prefix.length);
        expect(end).toBeGreaterThan(start);
        const body = output.subarray(start + prefix.length, end);
        expect(body.subarray(0, 9).toString('ascii')).toBe(
          `${index.toString(16).padStart(8, '0')};`,
        );
        expect(body.length).toBe(9 + framePayloadBytes);
        expect(body.subarray(9).every((byte) => byte === 0x71)).toBe(true);
        cursor = end + 1;
      }
      expect(output.indexOf(prefix, cursor)).toBe(-1);
      const sentinelIndex = output.indexOf(sentinel, cursor);
      if (process.platform === 'win32') expect(sentinelIndex).toBeGreaterThanOrEqual(cursor);
      else {
        expect(sentinelIndex).toBe(cursor);
        expect(sentinelIndex + sentinel.length).toBe(output.length);
      }
      expect(sentinelIndex).toBe(output.lastIndexOf(sentinel));
      expect(session.handle.sawRealEof).toBe(true);
      session.handle.dispose();
    },
  );

  nativePressureIt(
    'can dispose from an output callback while the bounded channel is under pressure',
    async () => {
      const handle = spawnPty({
        command: node(
          [
            "const fs = require('node:fs');",
            'const block = Buffer.alloc(64 * 1024, 0x71);',
            'for (;;) fs.writeSync(1, block);',
          ].join(''),
        ),
        env: environment(),
        columns: 80,
        rows: 24,
      });
      await new Promise<void>((resolve) => {
        handle.onData(() => {
          handle.dispose();
          resolve();
        });
      });
      expect(handle.sawRealEof).toBe(false);
    },
  );
});

describe.skipIf(process.platform === 'win32')('the Termwright-owned POSIX PTY', () => {
  it('changes the kernel PTY size without a scheduling delay', async () => {
    const session = collect(
      node(
        [
          'process.stdin.setRawMode(true);',
          'process.stdin.resume();',
          "process.stdout.write('READY');",
          "process.stdin.once('data', () => {",
          "const { spawnSync } = require('node:child_process');",
          "const size = spawnSync('stty', ['size'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] }).stdout.trim();",
          "process.stdout.write('SIZE=' + size);",
          'process.exit(0);',
          '});',
        ].join(''),
      ),
    );
    await waitForText(session.handle, session.chunks, 'READY');
    expect(session.handle.resize(132, 43)).toBe(true);
    session.handle.write(Buffer.from('?'));
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(session.text()).toContain('SIZE=43 132');
    session.handle.dispose();
  });

  it('reports a delivered signal and drains the terminal to EOF', async () => {
    const session = collect(
      node(["process.stdout.write('READY');", 'process.stdin.resume();'].join('')),
    );
    await waitForText(session.handle, session.chunks, 'READY');
    expect(session.handle.signal('TERM')).toBe(true);
    const [status] = await Promise.all([session.exit, session.handle.outputEnded]);
    expect(status).toEqual({ code: null, signal: 'SIGTERM' });
    expect(session.handle.sawRealEof).toBe(true);
    expect(session.handle.treeState()).toBe('gone');
    session.handle.dispose();
  });

  it('cancels a silent live session through owned wake descriptors', async () => {
    const session = collect(node('process.stdin.resume();'));
    session.handle.dispose();
    await session.handle.outputEnded;
    expect(session.handle.sawRealEof).toBe(false);
    expect(session.handle.endReason).toBeUndefined();
    expect(session.handle.treeState()).toBe('unsupported');
  });

  it('kills descendants at the unreaped root boundary so they cannot hold the PTY open', async () => {
    const session = collect(
      node(
        [
          "const { spawn } = require('node:child_process');",
          "const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: 'inherit' });",
          "process.stdout.write('CHILD=' + child.pid);",
          'child.unref();',
        ].join(''),
      ),
    );
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(session.text()).toMatch(/CHILD=\d+/u);
    expect(session.handle.sawRealEof).toBe(true);
    expect(session.handle.treeState()).toBe('gone');
    session.handle.dispose();
  });

  it.runIf(process.platform === 'linux')(
    'waits for worker threads after their process leader becomes a zombie',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'termwright-pidfd-'));
      try {
        const executable = join(directory, 'dead-thread-leader');
        const source = fileURLToPath(new URL('./fixtures/dead-thread-leader.c', import.meta.url));
        const compiled = spawnSync('cc', ['-pthread', source, '-o', executable], {
          encoding: 'utf8',
        });
        if (compiled.status !== 0) {
          throw new Error(
            `fixture compilation failed (${String(compiled.status)}): ${compiled.stderr}`,
          );
        }

        const session = collect(
          node(
            [
              "const { spawn } = require('node:child_process');",
              `const child = spawn(${JSON.stringify(executable)}, [], { stdio: ['inherit', 'inherit', 'inherit', 'pipe'] });`,
              "child.stdio[3].once('data', marker => {",
              'process.stdout.write(marker);',
              'child.stdio[3].destroy();',
              'child.unref();',
              '});',
            ].join(''),
          ),
        );
        await Promise.all([session.exit, session.handle.outputEnded]);
        expect(session.text()).toContain('DEAD_THREAD_LEADER_READY');
        expect(session.handle.treeState()).toBe('gone');
        session.handle.dispose();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
