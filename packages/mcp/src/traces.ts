/**
 * Open `.twtrace` archives, so an agent can investigate a recorded failure the
 * same way it drives a live terminal.
 *
 * The store owns nothing but readers and their ids: reconstruction (cast prefix,
 * nearest semantic snapshot, steps) belongs to `@termwright/trace`, and the
 * projection into the compact ref format is shared with the live tools.
 */
import { stat } from 'node:fs/promises';
import { openTrace, TraceError } from '@termwright/trace';
import type { TraceReader } from '@termwright/trace';
import { McpError, noSessionError } from './errors.js';

/** Ceilings for the replay side of the server. */
export const TRACE_LIMITS = Object.freeze({
  /** Archives kept open per MCP session; the least recently used is evicted. */
  maxOpen: 8,
  /** Refusal threshold for an archive, in bytes. */
  maxArchiveBytes: 128 * 1024 * 1024,
  /** Rows of reconstructed screen text a single frame may return. */
  maxFrameRows: 200,
});

/** One archive this session has open. */
export interface OpenTrace {
  /** Agent-facing handle, `tr1`, `tr2`, … */
  readonly id: string;
  readonly path: string;
  readonly reader: TraceReader;
  /** Bumped on every use, so eviction drops the coldest archive. */
  lastUsedAt: number;
}

/** Options for {@link TraceStore}. */
export interface TraceStoreOptions {
  readonly maxOpen?: number;
  readonly maxArchiveBytes?: number;
  /** Injectable clock, for tests. */
  readonly now?: () => number;
}

/**
 * Translates a `TraceError` into the server's error vocabulary.
 *
 * `@termwright/trace` mirrors the `TermwrightError` shape structurally rather
 * than extending it (its own NOTES.md explains why), so it is unwrapped here
 * instead of by `toErrorPayload`. The code and suggestion pass through as they
 * are; only the class changes.
 */
function rethrowTraceError(error: unknown, path: string): never {
  if (error instanceof TraceError) {
    throw new McpError(
      error.code,
      `${path}: ${error.message}`,
      error.diagnostics.suggestion ?? 'check that the path points at a .twtrace directory or zip',
    );
  }
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    throw new McpError(
      'not-found',
      `no trace at ${path}`,
      'pass the path of a .twtrace directory or zip a run wrote',
    );
  }
  throw error;
}

/** The `.twtrace` archives one MCP session has open. */
export class TraceStore {
  readonly #open = new Map<string, OpenTrace>();
  readonly #maxOpen: number;
  readonly #maxArchiveBytes: number;
  readonly #now: () => number;
  #counter = 0;

  constructor(options: TraceStoreOptions = {}) {
    this.#maxOpen = options.maxOpen ?? TRACE_LIMITS.maxOpen;
    this.#maxArchiveBytes = options.maxArchiveBytes ?? TRACE_LIMITS.maxArchiveBytes;
    this.#now = options.now ?? Date.now;
  }

  /** Handles of every archive still open. */
  list(): readonly OpenTrace[] {
    return [...this.#open.values()];
  }

  /**
   * Opens an archive and registers it under a fresh `tr<n>` handle.
   *
   * At the ceiling the least recently used archive is closed rather than the
   * call being refused: an agent can always re-open a path, but it cannot
   * recover from a server that has wedged itself on old readers. The evicted
   * handle is reported so the caller knows why it stopped working.
   */
  async open(
    path: string,
  ): Promise<{ readonly trace: OpenTrace; readonly evicted: string | null }> {
    let size: number;
    try {
      const stats = await stat(path);
      size = stats.isDirectory() ? 0 : stats.size;
    } catch (error) {
      rethrowTraceError(error, path);
    }
    if (size > this.#maxArchiveBytes) {
      throw new McpError(
        'capacity',
        `${path} is ${size} bytes; the ceiling is ${this.#maxArchiveBytes}`,
        'open the archive with @termwright/trace directly, or re-record with tighter limits',
      );
    }

    let reader: TraceReader;
    try {
      reader = await openTrace(path);
    } catch (error) {
      rethrowTraceError(error, path);
    }

    const evicted = await this.#evictIfFull();
    this.#counter += 1;
    const trace: OpenTrace = {
      id: `tr${this.#counter}`,
      path,
      reader,
      lastUsedAt: this.#now(),
    };
    this.#open.set(trace.id, trace);
    return { trace, evicted };
  }

  /** Looks up a handle and marks it as used. */
  get(id: string): OpenTrace {
    const trace = this.#open.get(id);
    if (trace === undefined) {
      const known = [...this.#open.keys()];
      throw noSessionError(
        `unknown trace ${JSON.stringify(id)}`,
        known.length === 0
          ? 'open one with trace.open'
          : `open traces: ${known.join(', ')} (an evicted handle has to be re-opened by path)`,
      );
    }
    trace.lastUsedAt = this.#now();
    return trace;
  }

  async #evictIfFull(): Promise<string | null> {
    if (this.#open.size < this.#maxOpen) return null;
    const coldest = [...this.#open.values()].reduce((oldest, candidate) =>
      candidate.lastUsedAt < oldest.lastUsedAt ? candidate : oldest,
    );
    this.#open.delete(coldest.id);
    await coldest.reader.close();
    return coldest.id;
  }

  /** Closes every open archive. Best-effort, so shutdown always completes. */
  async closeAll(): Promise<void> {
    const traces = [...this.#open.values()];
    this.#open.clear();
    await Promise.all(
      traces.map(async (trace) => {
        try {
          await trace.reader.close();
        } catch {
          // A reader that already released its handles is fine.
        }
      }),
    );
  }
}
