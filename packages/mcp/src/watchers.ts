import { McpError, noSessionError } from './errors.js';

export const WATCH_LIMITS = Object.freeze({ maxWatchers: 64 });

export type WatchOutcome =
  | {
      readonly status: 'matched';
      readonly terminal: string;
      readonly startRevision: number;
      readonly revision: number;
      readonly exit?: { readonly code: number | null; readonly signal: string | null };
    }
  | {
      readonly status: 'failed';
      readonly terminal: string;
      readonly startRevision: number;
      readonly revision: number;
      readonly error: string;
    };

interface WatchEntry {
  readonly id: string;
  readonly terminal: string;
  readonly startRevision: number;
  outcome?: WatchOutcome;
  readonly waiters: Set<(outcome: WatchOutcome) => void>;
  readonly controller: AbortController;
}

/** Durable, session-owned waits whose result survives an MCP request timeout. */
export class WatchStore {
  readonly #watchers = new Map<string, WatchEntry>();
  #counter = 0;

  start(
    terminal: string,
    startRevision: number,
    revision: () => number,
    operation: (
      signal: AbortSignal,
    ) => Promise<{ readonly exit?: { code: number | null; signal: string | null } }>,
  ): string {
    if (this.#watchers.size >= WATCH_LIMITS.maxWatchers) {
      throw new McpError(
        'capacity',
        `this MCP session already owns ${WATCH_LIMITS.maxWatchers} watchers`,
        'cancel or collect an existing watcher before starting another',
      );
    }
    this.#counter += 1;
    const id = `w${this.#counter}`;
    const controller = new AbortController();
    const entry: WatchEntry = { id, terminal, startRevision, waiters: new Set(), controller };
    this.#watchers.set(id, entry);
    void operation(controller.signal).then(
      (result) => {
        const currentRevision = this.#currentRevision(entry, revision);
        if (currentRevision === null) return;
        this.#settle(entry, {
          status: 'matched',
          terminal,
          startRevision,
          revision: currentRevision,
          ...(result.exit === undefined ? {} : { exit: result.exit }),
        });
      },
      (error: unknown) => {
        const currentRevision = this.#currentRevision(entry, revision);
        if (currentRevision === null) return;
        this.#settle(entry, {
          status: 'failed',
          terminal,
          startRevision,
          revision: currentRevision,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return id;
  }

  list(): readonly {
    id: string;
    terminal: string;
    startRevision: number;
    status: 'pending' | WatchOutcome['status'];
  }[] {
    return [...this.#watchers.values()].map((entry) => ({
      id: entry.id,
      terminal: entry.terminal,
      startRevision: entry.startRevision,
      status: entry.outcome?.status ?? 'pending',
    }));
  }

  wait(id: string, signal?: AbortSignal): Promise<WatchOutcome> {
    const entry = this.#watchers.get(id);
    if (entry === undefined) throw noSessionError(`unknown watcher ${JSON.stringify(id)}`);
    if (entry.outcome !== undefined) return Promise.resolve(entry.outcome);
    if (signal?.aborted === true) {
      return Promise.reject(signal.reason ?? new DOMException('watch wait aborted', 'AbortError'));
    }
    return new Promise<WatchOutcome>((resolve, reject) => {
      const deliver = (outcome: WatchOutcome): void => {
        signal?.removeEventListener('abort', abort);
        resolve(outcome);
      };
      const abort = (): void => {
        entry.waiters.delete(deliver);
        reject(signal?.reason ?? new DOMException('watch wait aborted', 'AbortError'));
      };
      entry.waiters.add(deliver);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  cancel(id: string): void {
    const entry = this.#watchers.get(id);
    if (entry === undefined) throw noSessionError(`unknown watcher ${JSON.stringify(id)}`);
    this.#watchers.delete(id);
    entry.controller.abort(new DOMException(`watcher ${id} cancelled`, 'AbortError'));
    const error = new McpError('no-session', `watcher ${id} was cancelled`);
    for (const waiter of entry.waiters) {
      // Turn cancellation into a buffered failure for every current receiver.
      waiter({
        status: 'failed',
        terminal: entry.terminal,
        startRevision: entry.startRevision,
        revision: entry.startRevision,
        error: error.message,
      });
    }
    entry.waiters.clear();
  }

  cancelTerminal(terminal: string): void {
    for (const entry of [...this.#watchers.values()]) {
      if (entry.terminal === terminal) this.cancel(entry.id);
    }
  }

  close(): void {
    for (const id of [...this.#watchers.keys()]) this.cancel(id);
  }

  #settle(entry: WatchEntry, outcome: WatchOutcome): void {
    if (!this.#watchers.has(entry.id)) return;
    entry.outcome = outcome;
    for (const waiter of entry.waiters) waiter(outcome);
    entry.waiters.clear();
  }

  #currentRevision(entry: WatchEntry, revision: () => number): number | null {
    if (!this.#watchers.has(entry.id)) return null;
    try {
      return revision();
    } catch {
      return entry.startRevision;
    }
  }
}
