/**
 * Log-file tailing.
 *
 * Terminal programs put their real diagnostics in a file, not on the screen —
 * the TUI is busy drawing. A session can therefore follow one or more log files
 * and publish their lines on the same timeline as everything else, so a failure
 * can be read next to the keystroke that caused it.
 *
 * The tail is deliberately dumb and bounded: it polls, it never blocks the
 * session, it truncates monstrous lines, it drops (and counts) floods, and it
 * survives the two things that happen to log files in the wild — truncation and
 * rotation — by starting over instead of erroring out.
 */
import { open, stat, type FileHandle } from 'node:fs/promises';
import type { AppLogSource } from './api.js';

/** How often each source is polled for new bytes. */
const POLL_MS = 40;

/** Bytes read from one file per poll; a burst is spread over several ticks. */
const MAX_READ_PER_TICK = 64 * 1024;

/** Longest line delivered; anything beyond is truncated with an ellipsis. */
const MAX_LINE_BYTES = 4 * 1024;

/**
 * Bytes of the file head kept as a fingerprint.
 *
 * Size alone cannot see a truncation: `copytruncate` rotation empties the file
 * and the program immediately writes fresh lines, so by the next poll the size
 * can be back at or above the old offset and the new content would be skipped
 * silently. Comparing the head catches it.
 */
const FINGERPRINT_BYTES = 64;

/** Rate limit, per source: lines per window before the rest are dropped. */
const RATE_WINDOW_MS = 250;
const MAX_LINES_PER_WINDOW = 250;

/** Diagnostic codes this module reports, mirroring `DiagnosticCode`. */
export type LogDiagnosticCode = 'log-dropped' | 'log-source';

/** Callbacks the session installs on the tailer. */
export interface LogTailHooks {
  onLine(source: AppLogSource, line: string): void;
  onDiagnostic(code: LogDiagnosticCode, detail: string, count?: number): void;
}

interface SourceState {
  readonly source: AppLogSource;
  handle: FileHandle | null;
  /** Byte offset already delivered. */
  offset: number;
  /** Inode of the open file, so a rename can be told from a write. */
  inode: number | null;
  /**
   * First bytes of the file as last seen, together with how many were taken.
   * The window is fixed once taken: comparing "the first min(64, size) bytes"
   * would grow with the file, so every append to a file shorter than the
   * window would read as a replacement.
   */
  fingerprint: { readonly value: string; readonly length: number } | null;
  pending: Buffer;
  attached: boolean;
  windowStartedAt: number;
  windowLines: number;
  droppedInWindow: number;
  reading: boolean;
}

function label(source: AppLogSource): string {
  return source.label ?? source.path;
}

/**
 * Follows a set of files for the lifetime of a session.
 *
 * A file that does not exist yet is waited for: programs routinely create their
 * log on first write, well after start-up. A file that already existed is
 * followed from its current end, so a session does not replay yesterday's log.
 */
export class LogTailer {
  readonly #states: SourceState[];
  readonly #hooks: LogTailHooks;
  #timer: NodeJS.Timeout | null = null;
  #stopped = false;
  #polling: Promise<void> | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(sources: readonly AppLogSource[], hooks: LogTailHooks) {
    this.#hooks = hooks;
    this.#states = sources.map((source) => ({
      source,
      handle: null,
      offset: 0,
      inode: null,
      fingerprint: null,
      pending: Buffer.alloc(0),
      attached: false,
      windowStartedAt: performance.now(),
      windowLines: 0,
      droppedInWindow: 0,
      reading: false,
    }));
  }

  /** Records where each existing file ends and starts polling. */
  async start(): Promise<void> {
    for (const state of this.#states) {
      try {
        const info = await stat(state.source.path);
        // Pre-existing content belongs to a previous run.
        state.offset = info.size;
        state.inode = info.ino;
      } catch {
        state.offset = 0;
      }
    }
    this.#timer = setInterval(() => {
      if (this.#polling !== null) return;
      this.#polling = this.#poll()
        .catch((error: unknown) => {
          this.#hooks.onDiagnostic('log-source', `log poll failed: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => { this.#polling = null; });
    }, POLL_MS);
    this.#timer.unref?.();
  }

  /** Stops polling and releases every handle. Idempotent. */
  async stop(): Promise<void> {
    this.#closePromise ??= this.#performStop();
    return this.#closePromise;
  }

  async #performStop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    await this.#polling;

    // The process has ended before session teardown calls us. Read every byte
    // currently visible at the source rather than waiting for another poll.
    const deadline = performance.now() + 5_000;
    for (const state of this.#states) {
      for (;;) {
        await this.#pollSource(state, true);
        const info = await stat(state.source.path).catch(() => null);
        if (info === null || state.offset >= info.size) break;
        if (performance.now() >= deadline) {
          throw new Error(`final log drain for ${label(state.source)} did not reach EOF`);
        }
      }
      this.#flushDropped(state);
      if (state.pending.length > 0) {
        this.#hooks.onDiagnostic(
          'log-source',
          `discarded ${state.pending.length} trailing byte${state.pending.length === 1 ? '' : 's'} from ${label(state.source)} because the final record had no newline`,
          state.pending.length,
        );
        state.pending = Buffer.alloc(0);
      }
    }

    const failures: unknown[] = [];
    for (const state of this.#states) {
      try { await state.handle?.close(); } catch (error) { failures.push(error); }
      state.handle = null;
    }
    if (failures.length > 0) throw new AggregateError(failures, 'failed to close application log sources');
  }

  async #poll(): Promise<void> {
    // Report drops on the tick, not only when the next line shows up: a flood
    // that stops would otherwise leave its losses unreported forever.
    const now = performance.now();
    for (const state of this.#states) {
      if (now - state.windowStartedAt >= RATE_WINDOW_MS) {
        this.#flushDropped(state);
        state.windowStartedAt = now;
        state.windowLines = 0;
      }
    }
    await Promise.all(this.#states.map((state) => this.#pollSource(state)));
  }

  async #pollSource(state: SourceState, final = false): Promise<void> {
    if ((this.#stopped && !final) || state.reading) return;
    state.reading = true;
    try {
      const info = await stat(state.source.path).catch(() => null);
      if (info === null) {
        // Gone, or not created yet. Either way: nothing to read, no error.
        if (state.attached) {
          await this.#reopen(state, 'the file disappeared');
        }
        return;
      }
      if (!state.attached) {
        state.attached = true;
        state.inode = info.ino;
        this.#hooks.onDiagnostic(
          'log-source',
          `following ${label(state.source)} from byte ${state.offset}`,
        );
      } else if (info.ino !== state.inode) {
        await this.#reopen(state, 'the file was replaced (rotated)');
        state.inode = info.ino;
      } else if (info.size < state.offset) {
        await this.#reopen(state, 'the file shrank (truncated)');
      } else if (await this.#headChanged(state, info.size)) {
        await this.#reopen(state, 'the head of the file changed (truncated and rewritten)');
      }
      if (this.#stopped && !final) return;
      await this.#readDelta(state, info.size);
    } finally {
      state.reading = false;
    }
  }

  /**
   * Reads the head of the file and compares it with the fingerprint taken when
   * the tail last advanced. Returns true when the file is no longer the one
   * being followed.
   */
  async #headChanged(state: SourceState, size: number): Promise<boolean> {
    const taken = state.fingerprint;
    if (taken === null || state.offset === 0) return false;
    // Fewer bytes than the window we fingerprinted means the file lost content.
    if (size < taken.length) return true;
    const head = await this.#readHead(state, taken.length);
    if (head === null) return false;
    return head !== taken.value;
  }

  /** Reads exactly `length` bytes from the start of the file. */
  async #readHead(state: SourceState, length: number): Promise<string | null> {
    if (length <= 0) return null;
    if (state.handle === null) {
      state.handle = await open(state.source.path, 'r').catch(() => null);
      if (state.handle === null) return null;
    }
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await state.handle
      .read(buffer, 0, length, 0)
      .catch(() => ({ bytesRead: 0 }));
    if (bytesRead < length) return null;
    return buffer.toString('base64');
  }

  /**
   * Takes the fingerprint once there is something to take, and widens it to the
   * full window as soon as the file is long enough. Widening is safe: the file
   * only ever grew, so those bytes are the same bytes.
   */
  async #refreshFingerprint(state: SourceState): Promise<void> {
    const current = state.fingerprint;
    if (current !== null && current.length >= FINGERPRINT_BYTES) return;
    const length = Math.min(FINGERPRINT_BYTES, state.offset);
    if (current !== null && length <= current.length) return;
    const value = await this.#readHead(state, length);
    if (value !== null) state.fingerprint = { value, length };
  }

  /** Starts the source over at byte zero, without treating it as a failure. */
  async #reopen(state: SourceState, reason: string): Promise<void> {
    await state.handle?.close().catch(() => {});
    state.handle = null;
    state.offset = 0;
    state.fingerprint = null;
    state.pending = Buffer.alloc(0);
    state.attached = false;
    this.#hooks.onDiagnostic(
      'log-source',
      `restarting the tail of ${label(state.source)}: ${reason}`,
    );
  }

  async #readDelta(state: SourceState, size: number): Promise<void> {
    if (size <= state.offset) return;
    if (state.handle === null) {
      state.handle = await open(state.source.path, 'r').catch(() => null);
      if (state.handle === null) {
        this.#hooks.onDiagnostic(
          'log-source',
          `cannot read ${label(state.source)}; will keep trying`,
        );
        state.attached = false;
        return;
      }
    }
    const length = Math.min(size - state.offset, MAX_READ_PER_TICK);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await state.handle.read(buffer, 0, length, state.offset).catch(() => ({
      bytesRead: 0,
    }));
    if (bytesRead <= 0) return;
    state.offset += bytesRead;
    await this.#refreshFingerprint(state);
    this.#consume(state, buffer.subarray(0, bytesRead));
  }

  #consume(state: SourceState, chunk: Buffer): void {
    state.pending = state.pending.length === 0 ? chunk : Buffer.concat([state.pending, chunk]);
    for (;;) {
      const newline = state.pending.indexOf(0x0a);
      if (newline === -1) break;
      const raw = state.pending.subarray(0, newline);
      state.pending = state.pending.subarray(newline + 1);
      this.#emit(state, raw);
    }
    // A line that never ends must not grow without bound.
    if (state.pending.length > MAX_LINE_BYTES) {
      const raw = state.pending.subarray(0, MAX_LINE_BYTES);
      state.pending = state.pending.subarray(MAX_LINE_BYTES);
      this.#emit(state, raw, true);
    }
  }

  #emit(state: SourceState, raw: Buffer, forced = false): void {
    const now = performance.now();
    if (now - state.windowStartedAt >= RATE_WINDOW_MS) {
      this.#flushDropped(state);
      state.windowStartedAt = now;
      state.windowLines = 0;
    }
    if (state.windowLines >= MAX_LINES_PER_WINDOW) {
      state.droppedInWindow += 1;
      return;
    }
    state.windowLines += 1;

    const truncated = forced || raw.length > MAX_LINE_BYTES;
    const text = raw.subarray(0, MAX_LINE_BYTES).toString('utf8').replace(/\r$/u, '');
    this.#hooks.onLine(state.source, truncated ? `${text}…` : text);
  }

  /** Reports a window's drops once, rather than once per lost line. */
  #flushDropped(state: SourceState): void {
    if (state.droppedInWindow === 0) return;
    const dropped = state.droppedInWindow;
    state.droppedInWindow = 0;
    this.#hooks.onDiagnostic(
      'log-dropped',
      `dropped ${dropped} line${dropped === 1 ? '' : 's'} from ${label(state.source)}: ` +
        `more than ${MAX_LINES_PER_WINDOW} lines arrived within ${RATE_WINDOW_MS} ms`,
      dropped,
    );
  }
}
