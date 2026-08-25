import { describe, expect, it } from 'vitest';
import type { ExitStatus } from './api.js';
import type { PtyBackend, PtyProcess, PtySpawnOptions, PtyUnsubscribe } from './pty.js';
import { launchTerminalWithBackend } from './session.js';

/**
 * A stream can stop for two reasons and only one of them is an ending.
 *
 * `outputEnded` settles either way, because a waiter must not outlive the
 * thing it waits for. A producer torn down with bytes still unread therefore
 * looks exactly like one whose source ended, and the screen that results is
 * missing its final output with nothing to indicate it — which is how a real
 * loss on a loaded machine shows up as a test failing on a line that looks
 * fine.
 */
class StoppingPty implements PtyProcess {
  readonly pid = 7;
  readonly lifecycle = { tree: 'posix-process-group', outputDrain: 'eof' } as const;
  readonly outputEnded = Promise.resolve();
  readonly #ended: boolean;
  readonly #exitListeners = new Set<(status: ExitStatus) => void>();

  constructor(ended: boolean) {
    this.#ended = ended;
  }

  write(): void {}
  resize(): void {}
  // A shutdown request this fake honours, because the supervisor is entitled
  // to a real exit and refusing one would fail the test for the wrong reason.
  signal(): void {
    this.#publishExit();
  }
  treeState(): 'gone' {
    return 'gone';
  }
  onData(): PtyUnsubscribe {
    return () => undefined;
  }
  onExit(cb: (status: ExitStatus) => void): PtyUnsubscribe {
    this.#exitListeners.add(cb);
    return () => this.#exitListeners.delete(cb);
  }
  sawOutputEnd = (): boolean => this.#ended;
  dispose(): void {
    this.#publishExit();
  }

  #publishExit(): void {
    for (const listener of [...this.#exitListeners]) listener({ code: 0, signal: null });
  }
}

function backendFor(pty: PtyProcess): PtyBackend {
  return {
    name: 'stopping',
    spawn(_options: PtySpawnOptions): PtyProcess {
      return pty;
    },
  };
}

describe('an output producer that stopped without ending', () => {
  it('says so, so a missing last line has a reason attached to it', async () => {
    const terminal = await launchTerminalWithBackend({
      command: ['app'],
      backend: backendFor(new StoppingPty(false)),
    });
    await terminal.close();
    const diagnostics = terminal.diagnostics();
    expect(diagnostics.map((entry) => entry.code)).toContain('truncated-output');
    // The message has to name what was lost rather than what was called, since
    // the reader is looking at a screen and wondering what is missing from it.
    expect(diagnostics.find((entry) => entry.code === 'truncated-output')?.detail).toMatch(
      /output written shortly before exit may be missing/u,
    );
  });

  it('stays quiet when the source really ended', async () => {
    const terminal = await launchTerminalWithBackend({
      command: ['app'],
      backend: backendFor(new StoppingPty(true)),
    });
    await terminal.close();
    expect(terminal.diagnostics().map((entry) => entry.code)).not.toContain('truncated-output');
  });
});
