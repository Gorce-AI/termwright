import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { encodeConPtyHostCursorResponse, parseConPtyHostCursorRequest } from '@termwright/protocol';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import { bunTestCapability } from '../../../scripts/test-support/bun-runtime.mjs';
import {
  spawnWindowsPty,
  type WindowsPtyExit,
  type WindowsPtyHandle,
  writeWindowsConsoleMarker,
  windowsConPtyRuntimeInfo,
  windowsCandidatePaths,
  windowsPtyAvailable,
} from './windows.js';

/**
 * The real backend, on the only platform that has one.
 *
 * These are the cases the campaign calls mandatory, and each of them is a
 * property no timer can establish: that the stream ends because the pipe
 * ended, that a descendant outliving its parent still gets its output
 * delivered, and that the tree is empty because the job says so.
 */
const windows = process.platform === 'win32' && windowsPtyAvailable();
const bun =
  windows &&
  bunTestCapability(() => spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0);

// These are behavioral certifications of the vendored native host, not normal
// application sessions. They exercise OpenConsole, PowerShell, Node/Bun,
// process trees and high-volume native channels. Reserving the complete host
// pressure envelope prevents their correctness from depending on another
// worker's unrelated ConPTY traffic.
const it = resourceAwareIt.resources({
  terminals: 1,
  traceWriters: 0,
  nativeHost: 'exclusive',
});

function collect(handle: WindowsPtyHandle): { text(): string } {
  const chunks: Uint8Array[] = [];
  handle.onData((data) => chunks.push(Uint8Array.from(data)));
  return {
    text(): string {
      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    },
  };
}

function node(script: string): readonly string[] {
  return [process.execPath, '-e', script];
}

const HOST_CURSOR_REQUEST = /\x1b\]8488;(twh-cpr-v1:q:[0-9a-f]{32})\x07/gu;

function hostCursorRequests(output: string): readonly string[] {
  return [...output.matchAll(HOST_CURSOR_REQUEST)]
    .map((match) => match[1])
    .filter((payload): payload is string => payload !== undefined);
}

function answerHostCursorRequests(
  handle: WindowsPtyHandle,
  output: string,
  answered: Set<string>,
): void {
  for (const match of output.matchAll(HOST_CURSOR_REQUEST)) {
    const payload = match[1];
    if (payload === undefined || answered.has(payload)) continue;
    const request = parseConPtyHostCursorRequest(payload);
    if (request === null) throw new Error(`invalid ConPTY host cursor request: ${payload}`);
    answered.add(payload);
    const runtime = output.indexOf('RESIZE-READY') >= 0;
    expect(
      handle.writeTerminalResponse(
        Buffer.from(
          encodeConPtyHostCursorResponse(request, runtime ? 3 : 1, runtime ? 17 : 1),
          'ascii',
        ),
      ),
    ).toBe('host-control');
  }
}

function attachHostControlResponder(
  handle: WindowsPtyHandle,
  output: { text(): string },
): () => void {
  const answeredHostCursorRequests = new Set<string>();
  let answeredPrimaryDeviceAttributes = false;
  const answer = (): void => {
    const observed = output.text();
    if (!answeredPrimaryDeviceAttributes && observed.includes('\x1b[c')) {
      answeredPrimaryDeviceAttributes = true;
      expect(handle.writeTerminalResponse(Buffer.from('\x1b[?1;2c', 'ascii'))).toBe(
        'host-control',
      );
    }
    answerHostCursorRequests(handle, observed, answeredHostCursorRequests);
  };
  const release = handle.onData(answer);
  answer();
  return release;
}

function answerStartupHostCursorRequests(
  handle: WindowsPtyHandle,
  output: string,
  runtimeReadyMarker: string,
  answered: Set<string>,
): void {
  const readyAt = output.indexOf(runtimeReadyMarker);
  for (const match of output.matchAll(HOST_CURSOR_REQUEST)) {
    const payload = match[1];
    if (payload === undefined || answered.has(payload)) continue;
    if (readyAt >= 0 && (match.index ?? Number.MAX_SAFE_INTEGER) >= readyAt) continue;
    const request = parseConPtyHostCursorRequest(payload);
    if (request === null) throw new Error(`invalid startup host cursor request: ${payload}`);
    answered.add(payload);
    expect(
      handle.writeTerminalResponse(
        Buffer.from(encodeConPtyHostCursorResponse(request, 1, 1), 'ascii'),
      ),
    ).toBe('host-control');
  }
}

function runtimeHostCursorRequests(output: string, readyMarker: string): readonly string[] {
  const readyAt = output.indexOf(readyMarker);
  if (readyAt < 0) return [];
  return [...new Set(hostCursorRequests(output.slice(readyAt)))];
}

function hostCursorResponse(payload: string, row: number, column: number): Buffer {
  const request = parseConPtyHostCursorRequest(payload);
  if (request === null) throw new Error(`invalid ConPTY host cursor request: ${payload}`);
  return Buffer.from(encodeConPtyHostCursorResponse(request, row, column), 'ascii');
}

function windowsAddonPath(): string {
  const require = createRequire(import.meta.url);
  const resolved = windowsCandidatePaths(process.arch)
    .map((candidate) => {
      try {
        return require.resolve(candidate);
      } catch {
        return undefined;
      }
    })
    .find((candidate) => candidate !== undefined);
  if (resolved === undefined) throw new Error('the Windows addon path is unavailable');
  return resolved;
}

/**
 * Waits for a marker in the stream, giving up after a budget.
 *
 * The budget is a diagnostic deadline, never a verdict: a test that reaches it
 * fails with what it did see, so the report names the missing thing instead of
 * saying only that time ran out. Nothing here treats elapsed time as evidence
 * of a state.
 */
async function waitForMarker(
  handle: WindowsPtyHandle,
  output: { text(): string },
  pattern: RegExp,
  budgetMs: number,
): Promise<RegExpMatchArray | undefined> {
  const existing = pattern.exec(output.text());
  if (existing !== null) return existing;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      release();
      resolve(undefined);
    }, budgetMs);
    const release = handle.onData(() => {
      const match = pattern.exec(output.text());
      if (match === null) return;
      clearTimeout(timer);
      release();
      resolve(match);
    });
  });
}

/** Waits for a lifecycle notice matching the pattern, within a budget. */
async function waitForNotice(
  handle: WindowsPtyHandle,
  pattern: RegExp,
  budgetMs: number,
): Promise<RegExpMatchArray | undefined> {
  const existing = handle.notices.map((notice) => pattern.exec(notice)).find((m) => m !== null);
  if (existing != null) return existing;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      release();
      resolve(undefined);
    }, budgetMs);
    const release = handle.onNotice((notice) => {
      const match = pattern.exec(notice);
      if (match === null) return;
      clearTimeout(timer);
      release();
      resolve(match);
    });
  });
}

/** A fresh directory for a probe's on-disk journal, plus the journal's path. */
function journalPath(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), `tw-conpty-${name}-`));
  return join(directory, 'journal.log');
}

/** What a probe managed to record before it stopped, or why nothing is there. */
function readJournal(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim() || '(empty)';
  } catch (error) {
    return `(unreadable: ${(error as NodeJS.ErrnoException).code ?? 'unknown'})`;
  }
}

/**
 * Waits for a line in a probe's journal, within a budget.
 *
 * Polled, because the writer is another process and there is no event to
 * subscribe to across that boundary. The poll is what makes the wait finite;
 * what decides the answer is the line being there.
 */
async function waitForJournalLine(
  path: string,
  pattern: RegExp,
  budgetMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (pattern.test(readJournal(path))) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Whether the operating system still has this process, asked of the OS. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const environment = (): Readonly<Record<string, string>> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env['TERM'] = 'xterm-256color';
  return env;
};

async function certifyConsoleMarkerMode(executable: string): Promise<void> {
  const marker = '\x1b]8487;native-console-marker\x07';
  const fixture = fileURLToPath(
    new URL('../../../scripts/fixtures/conpty-console-marker.ps1', import.meta.url),
  );
  const markerScript = fileURLToPath(
    new URL('../../../scripts/fixtures/conpty-console-marker.mjs', import.meta.url),
  );
  const markerDirectory = mkdtempSync(join(tmpdir(), 'tw conpty marker '));
  const spacedMarkerScript = join(markerDirectory, 'console marker.mjs');
  const publicEntry = new URL('../dist/index.js', import.meta.url).href;
  copyFileSync(markerScript, spacedMarkerScript);
  const handle = spawnWindowsPty({
    command: [
      'powershell.exe',
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      fixture,
    ],
    env: {
      ...environment(),
      TW_MARKER_NODE: executable,
      TW_MARKER_SCRIPT: spacedMarkerScript,
      TW_MARKER_TEXT: marker,
      TW_MARKER_PTY_ENTRY: publicEntry,
    },
    columns: 80,
    rows: 24,
  });
  const output = collect(handle);
  const releaseHostControlResponder = attachHostControlResponder(handle, output);
  const exited = new Promise<WindowsPtyExit>((resolve) => handle.onExit(resolve));
  try {
    const [status] = await Promise.all([exited, handle.outputEnded]);

    expect(status, output.text()).toEqual({ code: 0, signal: null });
    expect(output.text()).toContain(marker);
    expect(output.text()).toContain('MODE_RESTORED');
    expect(handle.sawRealEof).toBe(true);
  } finally {
    releaseHostControlResponder();
    handle.dispose();
  }
}

describe.skipIf(!windows)('ConPTY backend', { timeout: 30_000 }, () => {
  it('loads only the pinned, validated passthrough runtime', () => {
    const runtime = windowsConPtyRuntimeInfo();
    expect(runtime).toMatchObject({
      provider: 'termwright-patched-openconsole',
      upstreamCommit: 'dd494ac79a82a04e1e7252a91c8939a3c3039908',
      patchSha256: '41da3024330ad209b0d10a491584dc6958e721d40fa7bfa0c1aef7049c47bfbe',
      hostCursorRpc: 'twh-cpr-v1',
      mode: 'ordered-vt-passthrough',
      policy: 'strict',
      assetsValidated: true,
      coreExports: true,
      failureCode: '',
      failureWin32: 0,
    });
    expect(runtime).not.toHaveProperty('package');
    expect(runtime).not.toHaveProperty('version');
  });

  it('writes a console marker with VT enabled and restores the disabled mode', async () => {
    expect(() => writeWindowsConsoleMarker(-1, 'marker')).toThrow(
      /fd must be a non-negative integer/u,
    );
    expect(() => writeWindowsConsoleMarker(1, '')).toThrow(/marker must be a non-empty string/u);

    await certifyConsoleMarkerMode(process.execPath);
  });

  it.skipIf(!bun)('writes the same mode-safe console marker under Bun', async () => {
    await certifyConsoleMarkerMode('bun');
  });

  it('reports application modes without ConPTY control-plane injection', async () => {
    const focusOn = '\x1b[?1004h';
    const focusOff = '\x1b[?1004l';
    const win32On = '\x1b[?9001h';
    const win32Off = '\x1b[?9001l';
    const reset = '\x1bc';
    const childOutput = `BEGIN${focusOff}${focusOn}${win32Off}${win32On}${reset}${focusOn}${win32On}END`;
    const handle = spawnWindowsPty({
      command: node(`require("node:fs").writeSync(1, ${JSON.stringify(childOutput)})`),
      env: environment(),
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);
    await handle.outputEnded;
    const observed = output.text();

    // ConPTY inserted one SET after each RESET and two after RIS. The public
    // stream contains each original child byte exactly once instead.
    expect(observed).toContain(childOutput);
    // Its startup DA1 remains observable, but its adjacent host modes do not.
    expect(observed).toContain('\x1b[c');
    expect(observed).not.toContain(`\x1b[c${focusOn}${win32On}`);
    expect(handle.sawRealEof).toBe(true);
    handle.dispose();
  });

  it('routes addressed host cursor RPC separately from application CPR without leaking host replies', async () => {
    const fixture = fileURLToPath(
      new URL('../../../scripts/fixtures/conpty-observable-resize.ps1', import.meta.url),
    );
    const handle = spawnWindowsPty({
      command: [
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fixture,
      ],
      env: environment(),
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);
    const exited = new Promise<WindowsPtyExit>((resolve) => handle.onExit(resolve));
    const answeredHostCursorRequests = new Set<string>();

    try {
      const answerHostQueries = (): void => {
        answerHostCursorRequests(handle, output.text(), answeredHostCursorRequests);
      };
      handle.onData(answerHostQueries);
      answerHostQueries();
      // Complete OpenConsole's certified startup handshake causally. This is
      // the one query whose provenance is established by the startup prefix.
      expect(await waitForMarker(handle, output, /\x1b\[c/u, 10_000), output.text()).toBeDefined();
      expect(handle.writeTerminalResponse(Buffer.from('\x1b[?1;2c', 'ascii'))).toBe('host-control');

      expect(
        await waitForMarker(handle, output, /RESIZE-READY/u, 10_000),
        output.text(),
      ).toBeDefined();
      expect(handle.resize(120, 40)).toBe(true);

      // The fixture waits for the resize event and then calls
      // GetConsoleScreenBufferInfo. The pinned runtime emits an addressed
      // private query only then; standard DSR remains application-owned.
      expect(
        await waitForMarker(
          handle,
          output,
          /RESIZE-READY[\s\S]*\x1b\]8488;twh-cpr-v1:q:[0-9a-f]{32}\x07/u,
          10_000,
        ),
        output.text(),
      ).toBeDefined();

      // The runtime consumed only its matching token and committed the cursor.
      // The fixture proves no host reply reached the application queue,
      // disables VT input, and emits an ordinary application DSR.
      expect(
        await waitForMarker(
          handle,
          output,
          /HOST-CPR:16,2;HOST-REPLY-LEAK:false;APP-DSR:\x1b\[6n/u,
          10_000,
        ),
        output.text(),
      ).toBeDefined();
      expect(handle.writeTerminalResponse(Buffer.from('\x1b[9;17R', 'ascii'))).toBe(
        'application-win32-input',
      );

      expect(
        await waitForMarker(handle, output, /APP-CPR:1b5b393b313752;ESC-READY/u, 10_000),
        output.text(),
      ).toBeDefined();
      handle.writeApplicationInput(Buffer.from('\x1b', 'ascii'), 'key');

      const [status] = await Promise.all([exited, handle.outputEnded]);
      expect(status, output.text()).toEqual({ code: 0, signal: null });
      expect(output.text()).toContain('RESIZED:120x40;HOST-CPR:16,2;HOST-REPLY-LEAK:false');
      expect(output.text()).toContain(';APP-CPR:1b5b393b313752');
      expect(output.text()).toContain(';ESC:1b;VK:27;SCAN:1;REPEAT:1');
      expect(handle.sawRealEof).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it('cancels a dirty alternate-buffer cursor wait when VT tears the buffer down', async () => {
    const fixture = fileURLToPath(
      new URL('../../../scripts/fixtures/conpty-host-cursor-lifecycle.ps1', import.meta.url),
    );
    const handle = spawnWindowsPty({
      command: [
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fixture,
        '-Scenario',
        'alt-teardown',
      ],
      env: environment(),
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);
    const exited = new Promise<WindowsPtyExit>((resolve) => handle.onExit(resolve));
    const startupRequests = new Set<string>();
    const answerStartup = (): void => {
      answerStartupHostCursorRequests(handle, output.text(), 'ALT-READY', startupRequests);
    };
    handle.onData(answerStartup);
    answerStartup();

    try {
      expect(await waitForMarker(handle, output, /\x1b\[c/u, 10_000), output.text()).toBeDefined();
      expect(handle.writeTerminalResponse(Buffer.from('\x1b[?1;2c', 'ascii'))).toBe('host-control');
      expect(
        await waitForMarker(handle, output, /ALT-READY/u, 10_000),
        output.text(),
      ).toBeDefined();
      expect(handle.resize(120, 40)).toBe(true);
      expect(
        await waitForMarker(
          handle,
          output,
          /ALT-READY[\s\S]*\x1b\]8488;twh-cpr-v1:q:[0-9a-f]{32}\x07/u,
          10_000,
        ),
        output.text(),
      ).toBeDefined();
      const altOutput = output.text().slice(output.text().indexOf('ALT-READY'));
      const rawRequests = hostCursorRequests(altOutput);
      expect(rawRequests).toHaveLength(1);
      const requests = [...new Set(rawRequests)];
      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request).toBeDefined();

      handle.writeApplicationInput(Buffer.from('T', 'ascii'), 'key');
      expect(
        await waitForMarker(handle, output, /ALT-WAIT-RETURNED:ok;STALE-READY/u, 10_000),
        output.text(),
      ).toBeDefined();
      expect(handle.writeTerminalResponse(hostCursorResponse(request!, 5, 13))).toBe(
        'host-control',
      );
      handle.writeApplicationInput(Buffer.from('C', 'ascii'), 'key');

      const [status] = await Promise.all([exited, handle.outputEnded]);
      expect(status, output.text()).toEqual({ code: 0, signal: null });
      expect(output.text()).toContain('ALT-WAIT-RETURNED:ok;STALE-READY;STALE-LEAK:false');
      expect(handle.sawRealEof).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it('routes concurrent cursor requests for one dirty buffer by token and generation', async () => {
    const fixture = fileURLToPath(
      new URL('../../../scripts/fixtures/conpty-host-cursor-lifecycle.ps1', import.meta.url),
    );
    const handle = spawnWindowsPty({
      command: [
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fixture,
        '-Scenario',
        'same-buffer',
      ],
      env: environment(),
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);
    const exited = new Promise<WindowsPtyExit>((resolve) => handle.onExit(resolve));
    const startupRequests = new Set<string>();
    const answerStartup = (): void => {
      answerStartupHostCursorRequests(handle, output.text(), 'SAME-READY', startupRequests);
    };
    handle.onData(answerStartup);
    answerStartup();

    try {
      expect(await waitForMarker(handle, output, /\x1b\[c/u, 10_000), output.text()).toBeDefined();
      expect(handle.writeTerminalResponse(Buffer.from('\x1b[?1;2c', 'ascii'))).toBe('host-control');
      expect(
        await waitForMarker(handle, output, /SAME-READY/u, 10_000),
        output.text(),
      ).toBeDefined();
      expect(handle.resize(120, 40)).toBe(true);
      expect(
        await waitForMarker(
          handle,
          output,
          /SAME-READY[\s\S]*\x1b\]8488;twh-cpr-v1:q:[0-9a-f]{32}\x07[\s\S]*\x1b\]8488;twh-cpr-v1:q:[0-9a-f]{32}\x07/u,
          10_000,
        ),
        output.text(),
      ).toBeDefined();
      const sameBufferOutput = output.text().slice(output.text().indexOf('SAME-READY'));
      const rawRequests = hostCursorRequests(sameBufferOutput);
      expect(rawRequests).toHaveLength(2);
      const requests = [...new Set(rawRequests)];
      expect(requests).toHaveLength(2);
      expect(handle.writeTerminalResponse(hostCursorResponse(requests[1]!, 7, 31))).toBe(
        'host-control',
      );

      expect(
        await waitForMarker(handle, output, /CONCURRENT-SAME:2:30,6;STALE-READY/u, 10_000),
        output.text(),
      ).toBeDefined();
      expect(handle.writeTerminalResponse(hostCursorResponse(requests[0]!, 9, 41))).toBe(
        'host-control',
      );
      handle.writeApplicationInput(Buffer.from('C', 'ascii'), 'key');

      const [status] = await Promise.all([exited, handle.outputEnded]);
      expect(status, output.text()).toEqual({ code: 0, signal: null });
      expect(output.text()).toContain('CONCURRENT-SAME:2:30,6;STALE-READY;STALE-LEAK:false');
      expect(handle.sawRealEof).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it('keeps concurrent cursor requests isolated across physical screen buffers', async () => {
    const fixture = fileURLToPath(
      new URL('../../../scripts/fixtures/conpty-host-cursor-lifecycle.ps1', import.meta.url),
    );
    const handle = spawnWindowsPty({
      command: [
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fixture,
        '-Scenario',
        'physical-buffers',
      ],
      env: environment(),
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);
    const exited = new Promise<WindowsPtyExit>((resolve) => handle.onExit(resolve));
    const startupRequests = new Set<string>();
    const answerStartup = (): void => {
      answerStartupHostCursorRequests(handle, output.text(), 'PHYSICAL-A-READY', startupRequests);
    };
    handle.onData(answerStartup);
    answerStartup();

    try {
      expect(await waitForMarker(handle, output, /\x1b\[c/u, 10_000), output.text()).toBeDefined();
      expect(handle.writeTerminalResponse(Buffer.from('\x1b[?1;2c', 'ascii'))).toBe('host-control');
      expect(
        await waitForMarker(handle, output, /PHYSICAL-A-READY/u, 10_000),
        output.text(),
      ).toBeDefined();
      expect(handle.resize(120, 40)).toBe(true);
      expect(
        await waitForMarker(
          handle,
          output,
          /PHYSICAL-A-READY[\s\S]*\x1b\]8488;twh-cpr-v1:q:[0-9a-f]{32}\x07/u,
          10_000,
        ),
        output.text(),
      ).toBeDefined();
      const [firstRequest] = runtimeHostCursorRequests(output.text(), 'PHYSICAL-A-READY');
      expect(firstRequest).toBeDefined();

      handle.writeApplicationInput(Buffer.from('B', 'ascii'), 'key');
      expect(
        await waitForMarker(handle, output, /PHYSICAL-B-READY/u, 10_000),
        output.text(),
      ).toBeDefined();
      expect(handle.resize(121, 41)).toBe(true);
      expect(
        await waitForMarker(
          handle,
          output,
          /PHYSICAL-B-READY[\s\S]*\x1b\]8488;twh-cpr-v1:q:[0-9a-f]{32}\x07/u,
          10_000,
        ),
        output.text(),
      ).toBeDefined();
      const physicalOutput = output.text().slice(output.text().indexOf('PHYSICAL-A-READY'));
      const rawRequests = hostCursorRequests(physicalOutput);
      expect(rawRequests).toHaveLength(2);
      const requests = [...new Set(rawRequests)];
      expect(requests).toHaveLength(2);
      const secondRequest = requests.find((request) => request !== firstRequest);
      expect(secondRequest).toBeDefined();

      expect(handle.writeTerminalResponse(hostCursorResponse(secondRequest!, 7, 31))).toBe(
        'host-control',
      );
      expect(handle.writeTerminalResponse(hostCursorResponse(firstRequest!, 4, 11))).toBe(
        'host-control',
      );

      const [status] = await Promise.all([exited, handle.outputEnded]);
      expect(status, output.text()).toEqual({ code: 0, signal: null });
      expect(output.text()).toContain('MULTI:A=10,3;B=30,6');
      expect(handle.sawRealEof).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it('wakes cursor waiters on physical and active alternate buffers after real input EOF', async () => {
    const fixture = fileURLToPath(
      new URL('../../../scripts/fixtures/conpty-host-cursor-lifecycle.ps1', import.meta.url),
    );
    const handle = spawnWindowsPty({
      command: [
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fixture,
        '-Scenario',
        'input-eof',
      ],
      env: environment(),
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);
    const exited = new Promise<WindowsPtyExit>((resolve) => handle.onExit(resolve));
    const startupRequests = new Set<string>();
    const answerStartup = (): void => {
      answerStartupHostCursorRequests(handle, output.text(), 'EOF-A-READY', startupRequests);
    };
    handle.onData(answerStartup);
    answerStartup();

    try {
      expect(await waitForMarker(handle, output, /\x1b\[c/u, 10_000), output.text()).toBeDefined();
      expect(handle.writeTerminalResponse(Buffer.from('\x1b[?1;2c', 'ascii'))).toBe('host-control');
      expect(
        await waitForMarker(handle, output, /EOF-A-READY/u, 10_000),
        output.text(),
      ).toBeDefined();
      expect(handle.resize(120, 40)).toBe(true);
      expect(
        await waitForMarker(
          handle,
          output,
          /EOF-A-READY[\s\S]*\x1b\]8488;twh-cpr-v1:q:[0-9a-f]{32}\x07/u,
          10_000,
        ),
        output.text(),
      ).toBeDefined();

      handle.writeApplicationInput(Buffer.from('B', 'ascii'), 'key');
      expect(
        await waitForMarker(handle, output, /EOF-B-ALT-READY/u, 10_000),
        output.text(),
      ).toBeDefined();
      expect(handle.resize(121, 41)).toBe(true);
      expect(
        await waitForMarker(
          handle,
          output,
          /EOF-B-ALT-READY[\s\S]*\x1b\]8488;twh-cpr-v1:q:[0-9a-f]{32}\x07/u,
          10_000,
        ),
        output.text(),
      ).toBeDefined();

      const eofOutput = output.text().slice(output.text().indexOf('EOF-A-READY'));
      const rawRequests = hostCursorRequests(eofOutput);
      expect(rawRequests).toHaveLength(2);
      expect(new Set(rawRequests)).toHaveProperty('size', 2);

      // No cursor response is sent. This closes only the parent-owned input
      // writer; the still-live fixture must publish its completion through the
      // independently open output pipe before exiting normally.
      handle.closeInput();
      handle.closeInput();
      expect(() => handle.write(Buffer.from('after-eof'))).toThrow(/ConPTY input is closed/u);

      const [status] = await Promise.all([exited, handle.outputEnded]);
      expect(status, output.text()).toEqual({ code: 0, signal: null });
      expect(output.text()).toContain('EOF-WAITERS:2');
      expect(handle.sawRealEof).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it('reports a missing or modified runtime while session creation fails closed', () => {
    const sourceAddon = windowsAddonPath();
    const sourceRoot = dirname(sourceAddon);
    const missingRoot = mkdtempSync(join(tmpdir(), 'tw-conpty-missing-'));
    const missingAddon = join(missingRoot, 'termwright_pty.node');
    copyFileSync(sourceAddon, missingAddon);
    const missingProbe = [
      `const addon = require(${JSON.stringify(missingAddon)});`,
      'const info = addon.conPtyRuntimeInfo();',
      "if (info.failureCode !== 'vendored-bundle-missing' || info.assetsValidated !== false || info.coreExports !== false) process.exit(8);",
      "try { new addon.ConPtySession({ commandLine: 'cmd.exe /d /s /c exit 0', columns: 80, rows: 24 }, () => {}); process.exit(9); } catch (error) { if (!String(error).includes('vendored-bundle-missing')) process.exit(10); }",
    ].join('');
    const missing = spawnSync(process.execPath, ['-e', missingProbe], {
      encoding: 'utf8',
    });
    expect(missing.status, missing.stderr).toBe(0);

    const corruptRoot = mkdtempSync(join(tmpdir(), 'tw-conpty-corrupt-'));
    const corruptAddon = join(corruptRoot, 'termwright_pty.node');
    copyFileSync(sourceAddon, corruptAddon);
    cpSync(join(sourceRoot, 'vendor'), join(corruptRoot, 'vendor'), {
      recursive: true,
    });
    writeFileSync(join(corruptRoot, 'vendor', 'conpty.dll'), 'not the pinned DLL');
    const corruptProbe = [
      `const addon = require(${JSON.stringify(corruptAddon)});`,
      'const info = addon.conPtyRuntimeInfo();',
      "if (info.failureCode !== 'vendored-asset-digest-mismatch' || info.assetsValidated !== false || info.coreExports !== false) process.exit(11);",
      "try { new addon.ConPtySession({ commandLine: 'cmd.exe /d /s /c exit 0', columns: 80, rows: 24 }, () => {}); process.exit(12); } catch (error) { if (!String(error).includes('vendored-asset-digest-mismatch')) process.exit(13); }",
    ].join('');
    const corrupt = spawnSync(process.execPath, ['-e', corruptProbe], {
      encoding: 'utf8',
    });
    expect(corrupt.status, corrupt.stderr).toBe(0);

    const hostileCwd = mkdtempSync(join(tmpdir(), 'tw-conpty-cwd-'));
    mkdirSync(join(hostileCwd, 'vendor'));
    writeFileSync(join(hostileCwd, 'vendor', 'conpty.dll'), 'cwd injection');
    const isolated = spawnSync(
      process.execPath,
      [
        '-e',
        [
          `const addon = require(${JSON.stringify(sourceAddon)});`,
          'const info = addon.conPtyRuntimeInfo();',
          "if (info.provider !== 'termwright-patched-openconsole' || info.upstreamCommit !== 'dd494ac79a82a04e1e7252a91c8939a3c3039908' || info.patchSha256 !== '41da3024330ad209b0d10a491584dc6958e721d40fa7bfa0c1aef7049c47bfbe' || info.hostCursorRpc !== 'twh-cpr-v1' || info.assetsValidated !== true) process.exit(9);",
        ].join(''),
      ],
      { cwd: hostileCwd, encoding: 'utf8' },
    );
    expect(isolated.status, isolated.stderr).toBe(0);
  });

  it('pins validated runtime assets against mutation before a later session', () => {
    const sourceAddon = windowsAddonPath();
    const sourceRoot = dirname(sourceAddon);
    const lockedRoot = mkdtempSync(join(tmpdir(), 'tw-conpty-locked-'));
    const lockedAddon = join(lockedRoot, 'termwright_pty.node');
    copyFileSync(sourceAddon, lockedAddon);
    cpSync(join(sourceRoot, 'vendor'), join(lockedRoot, 'vendor'), {
      recursive: true,
    });
    const probe = [
      `const addon = require(${JSON.stringify(lockedAddon)});`,
      'const info = addon.conPtyRuntimeInfo();',
      `const host = ${JSON.stringify(join(lockedRoot, 'vendor'))} + "\\\\" + info.selectedHostArchitecture + "\\\\OpenConsole.exe";`,
      'let rejected = false;',
      "try { require('node:fs').unlinkSync(host); } catch (error) { rejected = error?.code === 'EPERM' || error?.code === 'EBUSY' || error?.code === 'EACCES'; }",
      'if (!rejected) process.exit(10);',
      "const session = new addon.ConPtySession({ commandLine: 'cmd.exe /d /s /c exit 0', columns: 80, rows: 24 }, () => {});",
      'session.dispose();',
    ].join('');
    const result = spawnSync(process.execPath, ['-e', probe], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(
      readFileSync(
        join(
          lockedRoot,
          'vendor',
          windowsConPtyRuntimeInfo().selectedHostArchitecture,
          'OpenConsole.exe',
        ),
      ).byteLength,
    ).toBeGreaterThan(0);
  });

  async function certifyCausalVtOrder(name: 'Node' | 'Bun', executable: string): Promise<void> {
    const cycles = 256;
    const script = [
      'const { writeSync } = require("node:fs");',
      `for (let index = 0; index < ${cycles}; index += 1) {`,
      '  const id = index.toString(16).padStart(4, "0");',
      '  writeSync(1, Buffer.from("A" + id + "\\x1b]8487;TW_CAUSAL;A;" + id + "\\x07"));',
      '  writeSync(1, Buffer.from("B" + id + "\\x1b]8487;TW_CAUSAL;B;" + id + "\\x07"));',
      '  writeSync(1, Buffer.from("A" + id + "\\x1b]8487;TW_CAUSAL;C;" + id + "\\x07"));',
      '}',
      'writeSync(1, Buffer.from("\\x1b[?1049hALT\\x1b]8487;TW_CAUSAL;ALT\\x07\\x1b[?1049lPRIMARY\\x1b]8487;TW_CAUSAL;FINAL\\x07"));',
    ].join('');
    const handle = spawnWindowsPty({
      command: [executable, '-e', script],
      env: environment(),
      columns: 100,
      rows: 30,
    });
    const output = collect(handle);
    await handle.outputEnded;
    const bytes = output.text();
    let cursor = bytes.indexOf('A0000\x1b]8487;TW_CAUSAL;A;0000\x07');
    expect(cursor, `${name} emitted no first causal frame`).toBeGreaterThanOrEqual(0);
    expect(bytes.slice(0, cursor)).not.toMatch(/[AB][0-9a-f]{4}/u);
    for (let index = 0; index < cycles; index += 1) {
      const id = index.toString(16).padStart(4, '0');
      for (const [text, phase] of [
        ['A', 'A'],
        ['B', 'B'],
        ['A', 'C'],
      ] as const) {
        const expected = `${text}${id}\x1b]8487;TW_CAUSAL;${phase};${id}\x07`;
        expect(bytes.indexOf(expected, cursor), `${name} frame ${phase}/${id}`).toBe(cursor);
        cursor += expected.length;
      }
    }
    const tail =
      '\x1b[?1049hALT\x1b]8487;TW_CAUSAL;ALT\x07\x1b[?1049lPRIMARY\x1b]8487;TW_CAUSAL;FINAL\x07';
    expect(bytes.indexOf(tail, cursor)).toBe(cursor);
    expect(handle.sawRealEof).toBe(true);
    handle.dispose();
  }

  it('preserves causal VT marker order for Node applications', async () => {
    await certifyCausalVtOrder('Node', process.execPath);
  });

  it.skipIf(!bun)('preserves causal VT marker order for Bun applications', async () => {
    await certifyCausalVtOrder('Bun', 'bun');
  });

  it('keeps legacy Console API deltas ahead of their following marker', async () => {
    const fixture = fileURLToPath(
      new URL('../../../scripts/fixtures/conpty-causal-order.ps1', import.meta.url),
    );
    const handle = spawnWindowsPty({
      command: [
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fixture,
      ],
      env: environment(),
      columns: 100,
      rows: 30,
    });
    const output = collect(handle);
    await handle.outputEnded;
    const bytes = output.text();
    let cursor = bytes.indexOf('A0000\x1b]8487;TW_LEGACY;A;0000\x07');
    expect(cursor).toBeGreaterThanOrEqual(0);
    for (let index = 0; index < 256; index += 1) {
      const id = index.toString(16).padStart(4, '0');
      const first = `A${id}\x1b]8487;TW_LEGACY;A;${id}\x07`;
      expect(bytes.indexOf(first, cursor), `legacy A/${id}`).toBe(cursor);
      cursor += first.length;
      const legacy = bytes.indexOf(`B${id}`, cursor);
      const marker = bytes.indexOf(`\x1b]8487;TW_LEGACY;B;${id}\x07`, cursor);
      expect(legacy, `legacy text/${id}`).toBeGreaterThanOrEqual(cursor);
      expect(marker, `legacy marker/${id} overtook its text`).toBeGreaterThan(legacy);
      cursor = marker + `\x1b]8487;TW_LEGACY;B;${id}\x07`.length;
      const final = `A${id}\x1b]8487;TW_LEGACY;C;${id}\x07`;
      expect(bytes.indexOf(final, cursor), `legacy C/${id}`).toBe(cursor);
      cursor += final.length;
    }
    expect(handle.sawRealEof).toBe(true);
    handle.dispose();
  });

  it('orders activation of an inactive console buffer before its marker', async () => {
    const fixture = fileURLToPath(
      new URL('../../../scripts/fixtures/conpty-inactive-buffer-order.ps1', import.meta.url),
    );
    const handle = spawnWindowsPty({
      command: [
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fixture,
      ],
      env: environment(),
      columns: 100,
      rows: 30,
    });
    const output = collect(handle);
    await handle.outputEnded;
    const bytes = output.text();
    const before = bytes.indexOf('ACTIVE-BEFORE\x1b]8487;TW_BUFFER;BEFORE\x07');
    const activated = bytes.indexOf('INACTIVE-BUFFER', before + 1);
    const after = bytes.indexOf('\x1b]8487;TW_BUFFER;AFTER\x07', activated + 1);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(activated, 'activation did not publish the inactive buffer').toBeGreaterThan(before);
    expect(after, 'the marker overtook the activated buffer contents').toBeGreaterThan(activated);
    expect(bytes).not.toContain('\x1b]8487;TW_BUFFER;INACTIVE\x07');
    expect(handle.sawRealEof).toBe(true);
    handle.dispose();
  });

  it('ends the stream on a real pipe EOF and delivers the last byte first', async () => {
    const handle = spawnWindowsPty({
      command: node('process.stdout.write("A".repeat(4096) + "\\r\\nFINAL_SENTINEL\\r\\n")'),
      env: environment(),
      columns: 100,
      rows: 30,
    });
    const output = collect(handle);
    await handle.outputEnded;
    // The stream ended because the pipe ended, and everything written before
    // that is already here — the ordering is the point of the single channel.
    expect(handle.sawRealEof).toBe(true);
    // ERROR_BROKEN_PIPE is the ordinary end once the last client detaches; 0
    // is a clean zero-byte read. Anything else means the stream ended for a
    // reason, and naming it here is what makes that visible.
    expect([0, 109]).toContain(handle.endReason);
    expect(output.text()).toContain('FINAL_SENTINEL');
    handle.dispose();
  });

  it('delivers a descendant’s output and lets it finish on its own terms', async () => {
    // Output from a process this host never spawned reaches the host in order,
    // and the descendant ends by running out of work rather than by being cut
    // off. Both halves matter: without the second, "it was gone afterwards"
    // would be satisfied by a descendant that had simply finished, which is
    // what an earlier version of this test proved while claiming otherwise.
    //
    // The descendant keeps a journal on disk. Everything it could say through
    // the console dies with the console, so the one channel that survives the
    // console is the one that can report how it ended.
    const journal = journalPath('descendant');
    const grandchild = join(dirname(journal), 'grandchild.cjs');
    writeFileSync(
      grandchild,
      [
        'const fs = require("node:fs");',
        'const note = (line) => { try { fs.appendFileSync(process.env.TW_PROBE_JOURNAL, line + "\\n"); } catch {} };',
        'note("up pid=" + process.pid);',
        'for (const signal of ["SIGHUP", "SIGINT", "SIGBREAK", "SIGTERM"]) {',
        '  try { process.on(signal, () => { note("signal " + signal); process.exit(9); }); } catch { note("no handler for " + signal); }',
        '}',
        'process.on("exit", (code) => note("exit " + code));',
        'process.stdout.on("error", (failure) => note("stdout error " + failure.code));',
        'process.stdout.write("CHILD_UP\\r\\n");',
        'setTimeout(() => { note("timer fired"); process.stdout.write("FINAL_CHILD_MARKER\\r\\n"); }, 400);',
      ].join('\n'),
      'utf8',
    );
    const script = [
      'const { spawn } = require("node:child_process");',
      'let report;',
      'try {',
      '  const child = spawn(process.execPath, [process.env.TW_PROBE_SCRIPT], { stdio: "inherit", detached: false });',
      '  report = child.pid === undefined ? "SPAWN_PID=none" : "SPAWN_PID=" + child.pid;',
      '  child.on("exit", (code, signal) => process.stdout.write("CHILD_EXIT=" + code + "/" + signal + "\\r\\n"));',
      '  child.on("error", (failure) => process.stdout.write("CHILD_ERROR=" + failure.message.replace(/\\s+/g, "_") + "\\r\\n"));',
      '} catch (error) { report = "SPAWN_ERROR=" + error.message.replace(/\\s+/g, "_"); }',
      'process.stdout.write(report + "\\r\\n");',
      // Long enough that the descendant's own deadline falls first. The
      // descendant's output has to be delivered while the console still
      // exists, because the console ending is what ends the descendant.
      'setTimeout(() => process.exit(0), 2000);',
    ].join('');
    const handle = spawnWindowsPty({
      command: node(script),
      env: {
        ...environment(),
        TW_PROBE_JOURNAL: journal,
        TW_PROBE_SCRIPT: grandchild,
      },
      columns: 100,
      rows: 30,
    });
    const output = collect(handle);
    // Registered before anything is awaited. The root exits within
    // milliseconds, so a listener attached after the first await can miss the
    // event entirely and wait for something that has already happened.
    let rootExited = false;
    const rootExit = new Promise<void>((resolve) => {
      handle.onExit(() => {
        rootExited = true;
        resolve();
      });
    });
    // `CHILD_UP` is the descendant's own voice: it proves the grandchild ran
    // and that its output reaches this pseudoconsole, which is what separates
    // a descendant that was never heard from one that was never delivered.
    const up = await waitForMarker(handle, output, /CHILD_UP|CHILD_(?:EXIT|ERROR)=\S+/u, 10_000);
    expect(
      up?.[0],
      `descendant never announced itself; root exited: ${rootExited}, ` +
        `saw ${JSON.stringify(output.text())}`,
    ).toBe('CHILD_UP');
    const spawned = /SPAWN_(?:PID|ERROR)=(\S+)/u.exec(output.text());
    // Counted while the root is demonstrably alive and the descendant has just
    // spoken: the job holds both, which is the containment this backend owes.
    expect(
      handle.activeProcesses(),
      `job did not hold both while the root was alive; ${spawned?.[0] ?? 'unreported'}`,
    ).toBeGreaterThan(1);
    // The descendant's own line, written by it and delivered through the
    // pseudoconsole. This is the part that is genuinely about this backend:
    // output from a process the host never spawned reaches the host in order.
    const marker = await waitForMarker(handle, output, /FINAL_CHILD_MARKER/u, 10_000);
    expect(
      marker,
      `descendant's output never arrived; its journal says ` +
        `${JSON.stringify(readJournal(journal))}`,
    ).toBeDefined();

    await rootExit;
    // The session's own count, taken natively at the instant the root left.
    // The exit event reaches JavaScript first and the notice describing that
    // instant follows it, so the account has to be waited for, not read.
    const atRootExit = await waitForNotice(
      handle,
      /root exited with \d+; job members (-?\d+)/u,
      5_000,
    );
    expect(atRootExit, `the session recorded no account of root exit`).toBeDefined();
    // Its own account of how it ended, which is the part a liveness check
    // cannot supply. A descendant that ran its exit hook finished; one whose
    // journal stops earlier was cut off, and the two are indistinguishable
    // from outside.
    expect(readJournal(journal), `notices ${JSON.stringify(handle.notices)}`).toMatch(
      /timer fired[\s\S]*exit 0/u,
    );

    await handle.outputEnded;
    expect(handle.sawRealEof).toBe(true);
    handle.dispose();
  });

  it('does not keep a console-attached descendant alive past its root', async () => {
    // The platform behaviour, pinned. The descendant has work still pending
    // when its root goes, so if it survived it would say so; it does not, and
    // its journal stops before the exit hook it installed — terminated, not
    // finished. Asserted rather than tolerated, so the day this changes is a
    // failing test instead of a quietly wider claim.
    const journal = journalPath('cutoff');
    const descendant = join(dirname(journal), 'cutoff.cjs');
    writeFileSync(
      descendant,
      [
        'const fs = require("node:fs");',
        'const note = (line) => { try { fs.appendFileSync(process.env.TW_PROBE_JOURNAL, line + "\\n"); } catch {} };',
        'note("up pid=" + process.pid);',
        'process.on("exit", (code) => note("exit " + code));',
        'process.stdout.write("CHILD_UP\\r\\n", () => { if (process.send) process.send("ready"); });',
        // Far enough out that the root is long gone first. Reaching it is what
        // survival would look like.
        'setTimeout(() => note("still here"), 2000);',
      ].join('\n'),
      'utf8',
    );
    const script = [
      'const { spawn } = require("node:child_process");',
      'const child = spawn(process.execPath, [process.env.TW_PROBE_SCRIPT], { stdio: ["inherit", "inherit", "inherit", "ipc"], detached: false });',
      'process.stdout.write("SPAWN_PID=" + child.pid + "\\r\\n");',
      'child.once("message", (message) => {',
      '  if (message !== "ready") return;',
      '  process.stdout.write("CHILD_UP_ACK\\r\\n", () => process.exit(0));',
      '});',
      'child.once("error", (error) => { process.stderr.write(String(error)); process.exit(1); });',
    ].join('');
    const handle = spawnWindowsPty({
      command: node(script),
      env: {
        ...environment(),
        TW_PROBE_JOURNAL: journal,
        TW_PROBE_SCRIPT: descendant,
      },
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);
    const rootExit = new Promise<void>((resolve) => {
      handle.onExit(() => resolve());
    });
    expect(
      await waitForMarker(handle, output, /CHILD_UP\r?\n/u, 10_000),
      `descendant never started; saw ${JSON.stringify(output.text())}`,
    ).toBeDefined();
    expect(
      await waitForMarker(handle, output, /CHILD_UP_ACK/u, 10_000),
      `root never acknowledged the descendant; saw ${JSON.stringify(output.text())}`,
    ).toBeDefined();
    await rootExit;
    // Given more than its pending deadline before asking. A descendant that
    // was still running would have written by now; one that never writes again
    // was stopped.
    expect(await waitForJournalLine(journal, /still here/u, 3_000)).toBe(false);
    expect(readJournal(journal), `notices ${JSON.stringify(handle.notices)}`).not.toMatch(
      /exit \d/u,
    );
    await handle.outputEnded;
    expect(handle.sawRealEof).toBe(true);
    handle.dispose();
  });

  it('owns a descendant that left the console, and names what kills the one that stayed', async () => {
    // Two things at once, and the second is why this exists.
    //
    // The property: ownership of the tree must not depend on the console. A
    // descendant detached from the console has no terminal, writes nowhere,
    // and is invisible to anything watching the stream — the job is the only
    // thing that can still speak for it. If ownership survives that, the hard
    // kill rests on something the console cannot take away.
    //
    // The question: a console-attached descendant is terminated the instant
    // its root exits, before this backend has run a line, and conhost's own
    // source does not explain it. `RemoveConsole` only recomputes the window
    // owner when the root leaves, and `CloseConsoleProcessState` is reached
    // from a broken output pipe — the host having stopped reading, which is
    // not what happens here. So the killer is unidentified, and the same case
    // run off the console separates the two suspects: if this one survives,
    // the console kills the other; if it dies too, the cause is in the process
    // layer and belongs to this backend.
    const journal = journalPath('detached');
    const descendant = join(dirname(journal), 'detached.cjs');
    writeFileSync(
      descendant,
      [
        'const fs = require("node:fs");',
        'const note = (line) => { try { fs.appendFileSync(process.env.TW_PROBE_JOURNAL, line + "\\n"); } catch {} };',
        'note("up pid=" + process.pid);',
        'process.on("exit", (code) => note("exit " + code));',
        // Outlives its root by enough that "still here" is a fact about the
        // descendant rather than about how promptly the root left.
        'setTimeout(() => { note("outlived the root"); }, 1500);',
        'setTimeout(() => { note("done"); }, 4000);',
      ].join('\n'),
      'utf8',
    );
    const script = [
      'const { spawn } = require("node:child_process");',
      // Detached: no console, no inherited handles, its own process group.
      // Still inside the job, because job membership is inherited and nothing
      // here asks to break away.
      'const child = spawn(process.execPath, [process.env.TW_PROBE_SCRIPT], { stdio: "ignore", detached: true });',
      'child.unref();',
      'process.stdout.write("SPAWN_PID=" + child.pid + "\\r\\n");',
      'setTimeout(() => process.exit(0), 300);',
    ].join('');
    const handle = spawnWindowsPty({
      command: node(script),
      env: {
        ...environment(),
        TW_PROBE_JOURNAL: journal,
        TW_PROBE_SCRIPT: descendant,
      },
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);
    const rootExit = new Promise<void>((resolve) => {
      handle.onExit(() => resolve());
    });
    const spawned = await waitForMarker(handle, output, /SPAWN_PID=(\d+)/u, 10_000);
    expect(
      spawned,
      `root never reported a spawn; saw ${JSON.stringify(output.text())}`,
    ).toBeDefined();
    const childPid = Number(spawned?.[1]);
    // The property. A descendant with no console is still ours, and the job is
    // what says so — nothing about this count comes from the stream.
    expect(
      handle.activeProcesses(),
      `job lost the console-less descendant while its root was alive; journal ` +
        `${JSON.stringify(readJournal(journal))}`,
    ).toBeGreaterThan(1);

    await rootExit;
    const atRootExit = await waitForNotice(
      handle,
      /root exited with \d+; job members (-?\d+)/u,
      5_000,
    );
    // The answer. Waiting for the descendant's own record of having outlived
    // its root, because a liveness check alone cannot separate "still running"
    // from "not dead yet".
    const outlived = await waitForJournalLine(journal, /outlived the root/u, 6_000);
    expect(
      {
        outlived,
        alive: Number.isFinite(childPid) && processAlive(childPid),
        members: atRootExit?.[1],
      },
      `journal ${JSON.stringify(readJournal(journal))}, notices ${JSON.stringify(handle.notices)}`,
    ).toEqual({ outlived: true, alive: true, members: '1' });

    // And it is still ours to end: the job takes it even though the console
    // never had it.
    handle.terminateTree();
    expect(processAlive(childPid)).toBe(false);
    handle.dispose();
  });

  it('drives a child that never writes anything', async () => {
    // No first-output gate: the session is usable from the moment it exists,
    // so input, resize and termination all work before a silent child speaks.
    // The child reports what the console handed it before it waits. A child
    // whose standard input is not a terminal never sees a keystroke no matter
    // what the host writes, and that is a different fault from input failing
    // to travel — one belongs to process creation, the other to the pipe.
    const script = [
      'const tty = require("node:tty");',
      'process.stdout.write("STDIN_TTY=" + tty.isatty(0) + ",STDOUT_TTY=" + tty.isatty(1) + "\\r\\n");',
      'process.stdin.resume();',
      'process.stdin.on("data", () => process.exit(0));',
    ].join('');
    const handle = spawnWindowsPty({
      command: node(script),
      env: environment(),
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);
    const releaseHostControlResponder = attachHostControlResponder(handle, output);
    try {
      expect(handle.resize(120, 40)).toBe(true);
      const spoke = await waitForMarker(
        handle,
        output,
        /STDIN_TTY=(\w+),STDOUT_TTY=(\w+)/u,
        10_000,
      );
      const processes = handle.activeProcesses();
      expect(
        processes,
        `child never reported its handles; saw ${JSON.stringify(output.text())}`,
      ).toBeGreaterThan(0);
      // A whole line, not a bare keystroke. A console that has not been put into
      // raw mode delivers input a line at a time, so a lone `x` sits in the
      // line buffer and the child waits for a carriage return that never comes —
      // which is what a silent child looks like from the outside. Sending the
      // return makes the input complete under either mode.
      // Armed before the write, because the child can be gone before the next
      // line of this test runs and a listener attached afterwards would wait for
      // an event that already happened.
      const exit = new Promise<'exit' | 'budget'>((resolve) => {
        const timer = setTimeout(() => {
          release();
          resolve('budget');
        }, 10_000);
        const release = handle.onExit(() => {
          clearTimeout(timer);
          release();
          resolve('exit');
        });
      });
      handle.write(Buffer.from('x\r'));
      const exited = await exit;
      // Naming which wait ran out is the whole difference between a report that
      // can be acted on and one that says only that something took too long.
      expect(
        exited,
        `child never exited after input; it reported ${spoke?.[0] ?? 'nothing'}, ` +
          `job members before the write: ${processes}, now: ${handle.activeProcesses()}`,
      ).toBe('exit');
      await handle.outputEnded;
    } finally {
      releaseHostControlResponder();
      handle.dispose();
    }
  });

  it('drains a fragmented console frame while the JavaScript edge is busy', async () => {
    // Six MiB forces at least 96 reads through ReaderLoop's 64 KiB buffer.
    // On Windows the TTY writer divides it further into WriteConsole calls,
    // which is the shape produced by tcell's Show().  The payload remains
    // below the native delivery queue's eight MiB byte budget.
    const payloadBytes = 6 * 1024 * 1024;
    const sentinel = 'DELIVERY_QUEUE_SENTINEL';
    const script = [
      'process.stdin.resume();',
      'process.stdin.once("data", () => {',
      `  const payload = Buffer.alloc(${payloadBytes}, 0x58);`,
      '  process.stdout.write(payload, () => {',
      `    process.stdout.write(${JSON.stringify(sentinel)}, () => process.exit(0));`,
      '  });',
      '});',
    ].join('\n');
    const handle = spawnWindowsPty({
      command: node(script),
      env: environment(),
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);

    handle.write(Buffer.from('go\r'));
    // Deliberately keep the JS event loop out of the delivery callback until
    // the child has completed its writes.  This is a process-exit barrier,
    // not a quiet window: the old 64-item TSFN queue stopped ReaderLoop,
    // filled the ConPTY pipe and could never reach this boundary.  A
    // byte-bounded single-edge queue continues draining and lets the child
    // exit without using elapsed time as evidence.
    const waited = spawnSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `try { $target = [Diagnostics.Process]::GetProcessById(${handle.pid}) } ` +
          `catch [ArgumentException] { exit 0 } ` +
          `catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 72 }; ` +
          `if (-not $target.WaitForExit(10000)) { exit 71 }; ` +
          `exit 0`,
      ],
      { encoding: 'utf8' },
    );
    if (waited.status !== 0) {
      handle.dispose();
      throw new Error(
        `fragmented console writer did not reach process exit ` +
          `(helper ${String(waited.status)}): ${waited.error?.message ?? waited.stderr}`,
      );
    }

    await handle.outputEnded;
    const observed = output.text();
    const sentinelAt = observed.indexOf(sentinel);
    expect(sentinelAt).toBeGreaterThanOrEqual(payloadBytes);
    let payloadStart = sentinelAt;
    while (payloadStart > 0 && observed.charCodeAt(payloadStart - 1) === 0x58) {
      payloadStart -= 1;
    }
    expect(sentinelAt - payloadStart).toBe(payloadBytes);
    expect(handle.sawRealEof).toBe(true);
    handle.dispose();
  });

  it('reassembles a codepoint split across reads', async () => {
    // Emoji byte-by-byte with pauses, so the split lands inside the sequence.
    const script = [
      'const bytes = Buffer.from("é😀家\\r\\n", "utf8");',
      'let index = 0;',
      'const timer = setInterval(() => {',
      '  if (index >= bytes.length) { clearInterval(timer); process.exit(0); }',
      '  else process.stdout.write(bytes.subarray(index, index + 1)); index += 1;',
      '}, 5);',
    ].join('');
    const handle = spawnWindowsPty({
      command: node(script),
      env: environment(),
      columns: 80,
      rows: 24,
    });
    const output = collect(handle);
    await handle.outputEnded;
    const text = output.text();
    expect(text).toContain('é');
    expect(text).toContain('😀');
    expect(text).toContain('家');
    expect(text).not.toContain('�');
    handle.dispose();
  });

  it('reports its tree empty only after the job says so', async () => {
    const handle = spawnWindowsPty({
      command: node('setInterval(() => {}, 1000);'),
      env: environment(),
      columns: 80,
      rows: 24,
    });
    expect(handle.activeProcesses()).toBeGreaterThan(0);
    handle.terminateTree();
    await handle.outputEnded;
    // Queried, not inferred: the job object is the owner, so this is a fact
    // about membership rather than a guess from a process-id snapshot.
    expect(handle.activeProcesses()).toBe(0);
    handle.dispose();
  });

  it('survives a hard kill in the middle of a large burst', async () => {
    const handle = spawnWindowsPty({
      command: node('setInterval(() => process.stdout.write("f".repeat(8192)), 1);'),
      env: environment(),
      columns: 200,
      rows: 50,
    });
    await new Promise<void>((resolve) => {
      handle.onData(() => resolve());
    });
    handle.terminateTree();
    await handle.outputEnded;
    expect(handle.sawRealEof).toBe(true);
    handle.dispose();
  });
});
