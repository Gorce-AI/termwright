import { describe, expect, it, vi } from 'vitest';
import type { ExitStatus } from './api.js';
import {
  createNativePtyBackend,
  encodeWin32InputModeTerminalResponse,
  NATIVE_PTY_BACKEND_NAME,
  type NativePtySessionHandle,
  type NativePtySpawn,
} from './native-pty-backend.js';

function fakeSession(overrides: Partial<NativePtySessionHandle> = {}): NativePtySessionHandle {
  return {
    pid: 4242,
    outputEnded: Promise.resolve(),
    sawRealEof: true,
    write: vi.fn(),
    resize: vi.fn(() => true),
    signal: vi.fn(() => true),
    treeState: vi.fn<() => 'alive' | 'gone' | 'unsupported'>(() => 'alive'),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
    onDrain: vi.fn(() => () => undefined),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe('the native PTY driver adapter', () => {
  it('encodes each ConPTY terminal-response byte as a synthesized Win32 key event', () => {
    const response = Buffer.from('\u001b[?2026;2$y', 'ascii');
    expect(Buffer.from(encodeWin32InputModeTerminalResponse(response)).toString('ascii')).toBe(
      [27, 91, 63, 50, 48, 50, 54, 59, 50, 36, 121]
        .map((byte) => `\u001b[0;0;${byte};1;0;1_`)
        .join(''),
    );
  });

  it('rejects a non-ASCII terminal response instead of corrupting its UTF-16 key records', () => {
    expect(() => encodeWin32InputModeTerminalResponse(Uint8Array.of(0xc3, 0xa9))).toThrow(
      /non-ASCII byte 0xc3/u,
    );
  });

  it('uses Win32 Input Mode only for terminal responses on Windows', () => {
    const windowsSession = fakeSession();
    const posixSession = fakeSession();
    const windows = createNativePtyBackend(() => windowsSession, 'win32').spawn({
      command: ['C:\\app.exe'],
      env: {},
      columns: 80,
      rows: 24,
    });
    const posix = createNativePtyBackend(() => posixSession, 'linux').spawn({
      command: ['/app'],
      env: {},
      columns: 80,
      rows: 24,
    });
    const response = Buffer.from('\u001b[1;1R', 'ascii');

    windows.writeTerminalResponse?.(response);
    posix.writeTerminalResponse?.(response);

    expect(windowsSession.write).toHaveBeenCalledWith(
      encodeWin32InputModeTerminalResponse(response),
    );
    expect(posixSession.write).toHaveBeenCalledWith(response);
  });

  it('exposes authoritative EOF and the native platform ownership model', () => {
    const posix = createNativePtyBackend(() => fakeSession(), 'darwin');
    const windows = createNativePtyBackend(() => fakeSession(), 'win32');
    expect(posix.name).toBe(NATIVE_PTY_BACKEND_NAME);
    expect(posix.spawn({ command: ['/app'], env: {}, columns: 80, rows: 24 }).lifecycle).toEqual({
      tree: 'posix-process-group',
      outputDrain: 'eof',
    });
    expect(
      windows.spawn({ command: ['C:\\app.exe'], env: {}, columns: 80, rows: 24 }).lifecycle,
    ).toEqual({ tree: 'conpty-console', outputDrain: 'eof' });
  });

  it('passes argv and the final TERM without a shell', () => {
    const spawn = vi.fn<NativePtySpawn>(() => fakeSession());
    createNativePtyBackend(spawn, 'linux').spawn({
      command: ['/app', 'two words', '*'],
      cwd: '/work',
      env: { PATH: '/bin', TERM: 'vt100' },
      columns: 120,
      rows: 40,
      term: 'xterm',
    });
    expect(spawn).toHaveBeenCalledWith({
      command: ['/app', 'two words', '*'],
      cwd: '/work',
      env: { PATH: '/bin', TERM: 'xterm' },
      columns: 120,
      rows: 40,
    });
  });

  it('preserves data and exit emitted before the driver subscribes', async () => {
    let data: ((bytes: Uint8Array) => void) | undefined;
    let exit: ((status: ExitStatus) => void) | undefined;
    const process = createNativePtyBackend(
      () =>
        fakeSession({
          onData(listener) {
            data = listener;
            return () => undefined;
          },
          onExit(listener) {
            exit = listener;
            return () => undefined;
          },
        }),
      'linux',
    ).spawn({ command: ['/app'], env: {}, columns: 80, rows: 24 });
    data?.(Buffer.from('first'));
    exit?.({ code: 7, signal: null });
    const observed: Array<string | ExitStatus> = [];
    process.onData((bytes) => observed.push(Buffer.from(bytes).toString('utf8')));
    process.onExit((status) => observed.push(status));
    await Promise.resolve();
    expect(observed).toEqual(['first', { code: 7, signal: null }]);
  });

  it('maps signals, write drain, errors and tree state without policy', async () => {
    let fail: ((error: Error) => void) | undefined;
    let drain: (() => void) | undefined;
    const session = fakeSession({
      onError(listener) {
        fail = listener;
        return () => undefined;
      },
      onDrain(listener) {
        drain = listener;
        return () => undefined;
      },
      treeState: vi.fn<() => 'alive' | 'gone' | 'unsupported'>(() => 'gone'),
    });
    const process = createNativePtyBackend(() => session, 'linux').spawn({
      command: ['/app'],
      env: {},
      columns: 80,
      rows: 24,
    });
    const failures: Error[] = [];
    const drains: number[] = [];
    process.onWriteError?.((error) => failures.push(error));
    process.onWriteDrain?.(() => drains.push(1));
    const error = new Error('native write failed');
    fail?.(error);
    drain?.();
    process.signal('TERM');
    await process.hardKillTree?.(new AbortController().signal);
    expect(session.signal).toHaveBeenNthCalledWith(1, 'TERM');
    expect(session.signal).toHaveBeenNthCalledWith(2, 'KILL');
    expect(failures).toEqual([error]);
    expect(drains).toEqual([1]);
    expect(process.treeState?.()).toBe('gone');
  });

  it('preserves a native POSIX signal errno for lifecycle reconciliation', () => {
    const refusal = Object.assign(new Error('kill(PTY process group) failed'), {
      code: 'EPERM',
      errno: 1,
    });
    const process = createNativePtyBackend(
      () =>
        fakeSession({
          signal: () => {
            throw refusal;
          },
        }),
      'darwin',
    ).spawn({ command: ['/app'], env: {}, columns: 80, rows: 24 });

    let observed: unknown;
    try {
      process.signal('HUP');
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(refusal);
  });

  it('preserves the native tree-probe failure behind unsupported state', () => {
    let fail: ((error: Error) => void) | undefined;
    const session = fakeSession({
      onError(listener) {
        fail = listener;
        return () => undefined;
      },
      treeState: () => 'unsupported',
    });
    const process = createNativePtyBackend(() => session, 'linux').spawn({
      command: ['/app'],
      env: {},
      columns: 80,
      rows: 24,
    });
    const error = Object.assign(new Error('drain(PTY process group) failed: Too many open files'), {
      code: 'EMFILE',
      errno: 24,
    });
    fail?.(error);

    let observed: unknown;
    try {
      process.treeState?.();
    } catch (failure) {
      observed = failure;
    }
    expect(observed).toBe(error);
  });

  it('disposes the session and all four native subscriptions exactly once', () => {
    const releases = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const session = fakeSession({
      onData: vi.fn(() => releases[0]!),
      onExit: vi.fn(() => releases[1]!),
      onError: vi.fn(() => releases[2]!),
      onDrain: vi.fn(() => releases[3]!),
    });
    const process = createNativePtyBackend(() => session, 'linux').spawn({
      command: ['/app'],
      env: {},
      columns: 80,
      rows: 24,
    });
    process.dispose();
    process.dispose();
    expect(() => process.write(Buffer.from('late'))).toThrow(/input is closed/u);
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
    expect(session.dispose).toHaveBeenCalledOnce();
  });
});
