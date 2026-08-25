import { describe, expect, it, vi } from 'vitest';
import {
  CONPTY_BACKEND_NAME,
  createConPtyBackend,
  type ConPtySessionHandle,
  type ConPtySpawn,
} from './conpty-backend.js';

/**
 * The translation, checked without a pseudoconsole.
 *
 * What a Windows machine proves is that the session behaves; what these prove
 * is that the driver is told the truth about it. The two are separable, and
 * keeping them separate is what lets the mapping be verified on every platform
 * instead of only where it runs.
 */
function fakeSession(overrides: Partial<ConPtySessionHandle> = {}): ConPtySessionHandle {
  return {
    pid: 4242,
    outputEnded: Promise.resolve(),
    sawRealEof: true,
    write: vi.fn(),
    resize: vi.fn(() => true),
    terminateTree: vi.fn(),
    activeProcesses: vi.fn(() => 1),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe('the ConPTY backend as the driver sees it', () => {
  it('claims an end of output that is a pipe ending, and a tree that is owned', () => {
    const backend = createConPtyBackend(() => fakeSession());
    expect(backend.name).toBe(CONPTY_BACKEND_NAME);
    const pty = backend.spawn({ command: ['app.exe'], env: {}, columns: 80, rows: 24 });
    // Both are load-bearing. `eof` is what lets a session wait for the producer
    // instead of spending a fallback budget on every natural exit, and it would
    // be a lie on a backend whose stream ends on a timer.
    expect(pty.lifecycle).toEqual({ tree: 'conpty-console', outputDrain: 'eof' });
  });

  it('carries the command through without inventing a shell', () => {
    const spawn = vi.fn<ConPtySpawn>(() => fakeSession());
    createConPtyBackend(spawn).spawn({
      command: ['app.exe', 'first argument', 'C:\\path\\'],
      cwd: 'C:\\work',
      env: { PATH: 'C:\\bin' },
      columns: 120,
      rows: 40,
    });
    expect(spawn).toHaveBeenCalledWith({
      command: ['app.exe', 'first argument', 'C:\\path\\'],
      cwd: 'C:\\work',
      env: { PATH: 'C:\\bin', TERM: 'xterm-256color' },
      columns: 120,
      rows: 40,
    });
  });

  it('lets the caller choose its own TERM and defaults only when it does not', () => {
    const spawn = vi.fn<ConPtySpawn>(() => fakeSession());
    createConPtyBackend(spawn).spawn({
      command: ['app.exe'],
      env: { TERM: 'xterm' },
      columns: 80,
      rows: 24,
      term: 'vt100',
    });
    expect(spawn.mock.calls[0]?.[0].env['TERM']).toBe('vt100');
  });

  it('omits cwd rather than passing undefined, so the child inherits it', () => {
    const spawn = vi.fn<ConPtySpawn>(() => fakeSession());
    createConPtyBackend(spawn).spawn({ command: ['app.exe'], env: {}, columns: 80, rows: 24 });
    expect(spawn.mock.calls[0]?.[0]).not.toHaveProperty('cwd');
  });

  it('kills the tree for KILL and refuses the signals Windows cannot deliver', () => {
    const session = fakeSession();
    const pty = createConPtyBackend(() => session).spawn({
      command: ['app.exe'],
      env: {},
      columns: 80,
      rows: 24,
    });
    pty.signal('KILL');
    expect(session.terminateTree).toHaveBeenCalledTimes(1);
    // Refused rather than dropped. A caller that believes it asked for a
    // graceful shutdown and got silence is worse off than one told the
    // platform has no such thing.
    for (const sig of ['INT', 'TERM', 'HUP'] as const) {
      // The code, not the wording. A caller separating "this platform cannot"
      // from "this failed" reads that, and swapping backends must not change
      // which of the two it is being told.
      expect(() => pty.signal(sig)).toThrowError(
        expect.objectContaining({ code: 'unsupported-signal' }),
      );
    }
    expect(session.terminateTree).toHaveBeenCalledTimes(1);
  });

  it('answers tree liveness from the job, and says so when the job cannot answer', () => {
    const members = vi.fn(() => 2);
    const pty = createConPtyBackend(() => fakeSession({ activeProcesses: members })).spawn({
      command: ['app.exe'],
      env: {},
      columns: 80,
      rows: 24,
    });
    expect(pty.treeState?.()).toBe('alive');
    members.mockReturnValue(0);
    expect(pty.treeState?.()).toBe('gone');
    // A query that failed is not an empty tree. Reporting it as one would turn
    // a broken handle into a proof that nothing is running.
    members.mockReturnValue(-1);
    expect(pty.treeState?.()).toBe('unsupported');
  });

  it('reports the exit code and never invents a signal for it', () => {
    let publish: ((status: { code: number | null; signal: string | null }) => void) | undefined;
    const session = fakeSession({
      onExit: vi.fn((listener) => {
        publish = listener;
        return () => undefined;
      }),
    });
    const pty = createConPtyBackend(() => session).spawn({
      command: ['app.exe'],
      env: {},
      columns: 80,
      rows: 24,
    });
    const seen: unknown[] = [];
    pty.onExit((status) => seen.push(status));
    publish?.({ code: 3, signal: null });
    expect(seen).toEqual([{ code: 3, signal: null }]);
  });

  it('surfaces an asynchronous write failure to whoever asked about writes', () => {
    let fail: ((error: Error) => void) | undefined;
    const session = fakeSession({
      onError: vi.fn((listener) => {
        fail = listener;
        return () => undefined;
      }),
    });
    const pty = createConPtyBackend(() => session).spawn({
      command: ['app.exe'],
      env: {},
      columns: 80,
      rows: 24,
    });
    const seen: Error[] = [];
    pty.onWriteError?.((error) => seen.push(error));
    const failure = new Error('WriteFile(conpty input) failed');
    fail?.(failure);
    expect(seen).toEqual([failure]);
  });

  it('is attached the moment it exists, because nothing was deferred', async () => {
    const pty = createConPtyBackend(() => fakeSession()).spawn({
      command: ['app.exe'],
      env: {},
      columns: 80,
      rows: 24,
    });
    await expect(pty.attach?.(new AbortController().signal)).resolves.toBeUndefined();
  });

  it('disposes once, however many times it is asked', () => {
    const session = fakeSession();
    const pty = createConPtyBackend(() => session).spawn({
      command: ['app.exe'],
      env: {},
      columns: 80,
      rows: 24,
    });
    pty.dispose();
    pty.dispose();
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });
});
