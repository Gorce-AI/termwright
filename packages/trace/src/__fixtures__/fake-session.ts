/**
 * In-memory stand-in for a `TerminalHarness`, used by the package's own tests.
 * Not exported from `src/index.ts` — it never ships.
 */

import type { LogRecord, ObservationStamp, SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import type {
  CrashReport,
  ExitStatus,
  SessionEventMap,
  SessionEvents,
} from '@termwright/driver';
import type { TraceSource } from '../writer.js';

type Listener = (payload: never) => void;

/** A session whose clock and event stream the test drives by hand. */
export class FakeSession implements TraceSource {
  readonly sessionId: string;
  #listeners = new Map<keyof SessionEventMap, Set<Listener>>();
  #tree: SemanticSnapshot | null = null;
  #actionCounter = 0;
  /** Milliseconds since session start; advance it with {@link tick}. */
  clock = 0;

  constructor(sessionId = 't1') {
    this.sessionId = sessionId;
  }

  /** Injectable clock for `createTraceWriter({ now })`. */
  readonly now = (): number => this.clock;

  /** Advances the clock by `ms` and returns the new value. */
  tick(ms: number): number {
    this.clock += ms;
    return this.clock;
  }

  readonly events: SessionEvents = {
    on: <E extends keyof SessionEventMap>(
      event: E,
      callback: (payload: SessionEventMap[E]) => void,
    ): (() => void) => {
      const set = this.#listeners.get(event) ?? new Set<Listener>();
      set.add(callback as Listener);
      this.#listeners.set(event, set);
      return () => {
        set.delete(callback as Listener);
      };
    },
  };

  semanticTree(): SemanticSnapshot | null {
    return this.#tree;
  }

  #emit<E extends keyof SessionEventMap>(event: E, payload: SessionEventMap[E]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      (listener as (value: SessionEventMap[E]) => void)(payload);
    }
  }

  /** Emits terminal output at the current clock. */
  output(text: string): void {
    this.#emit('output', { data: new TextEncoder().encode(text), timeMs: this.clock });
  }

  /** Emits raw output bytes, for split-multibyte tests. */
  outputBytes(bytes: Uint8Array): void {
    this.#emit('output', { data: bytes, timeMs: this.clock });
  }

  /** Emits PTY input at the current clock. */
  input(text: string, kind: SessionEventMap['input']['kind'] = 'key'): void {
    this.#emit('input', {
      data: new TextEncoder().encode(text),
      timeMs: this.clock,
      kind,
    });
  }

  resize(columns: number, rows: number): void {
    this.#emit('resize', { columns, rows, timeMs: this.clock });
  }

  /** Publishes a tree and emits the matching `semantic-revision`. */
  semantic(snapshot: SemanticSnapshot): void {
    this.#tree = snapshot;
    this.#emit('semantic-revision', { revision: snapshot.revision, timeMs: this.clock });
  }

  /**
   * Emits a driver action, which the driver reports *after* it finished — so
   * a test that sends input then emits the action mirrors the real order.
   */
  action(
    api: string,
    outcome: { ok?: boolean; selector?: string; ref?: string; error?: string; observation?: ObservationStamp } = {},
  ): void {
    this.#emit('action', {
      actionId: `a${++this.#actionCounter}`,
      api,
      ok: outcome.ok ?? true,
      ...(outcome.selector === undefined ? {} : { selector: outcome.selector }),
      ...(outcome.ref === undefined ? {} : { ref: outcome.ref }),
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
      ...(outcome.observation === undefined ? {} : { observation: outcome.observation }),
      timeMs: this.clock,
    });
  }

  /** Emits a line read from a followed log file. */
  logLine(line: string, label = 'app.log', path = `/var/log/${label}`): void {
    this.#emit('app-log', { source: 'file', label, path, line, timeMs: this.clock });
  }

  /** Emits a structured record from an instrumented adapter. */
  logRecord(record: Partial<LogRecord> & { message: string }): void {
    this.#emit('app-log', {
      source: 'adapter',
      ...(record.logger === undefined ? {} : { label: record.logger }),
      record: {
        ts: record.ts ?? Date.UTC(2026, 7, 16),
        level: record.level ?? 'info',
        message: record.message,
        seq: record.seq ?? ++this.#logSeq,
        ...(record.attrs === undefined ? {} : { attrs: record.attrs }),
        ...(record.logger === undefined ? {} : { logger: record.logger }),
        ...(record.revision === undefined ? {} : { revision: record.revision }),
      },
      timeMs: this.clock,
    });
  }

  #logSeq = 0;

  exit(code: number | null, signal: string | null = null): void {
    this.#emit('exit', { code, signal, timeMs: this.clock });
  }

  /**
   * Emits a crash report, then the exit that follows it — the driver's order,
   * where `crash` lands before `exit` and `exit` only after the emulator has
   * drained.
   */
  crash(report: Partial<CrashReport> & { exit?: ExitStatus } = {}): void {
    const exit: ExitStatus = report.exit ?? { code: null, signal: 'SIGSEGV' };
    this.#emit('crash', {
      exit,
      screenTail: report.screenTail ?? ['panic: runtime error', 'goroutine 1 [running]:'],
      lastSemanticTree: report.lastSemanticTree ?? this.#tree,
      recentInputs: report.recentInputs ?? [
        { timeMs: this.clock - 20, kind: 'key', bytes: 1, preview: 'q' },
      ],
      diagnosticsTail: report.diagnosticsTail ?? [],
      timeMs: report.timeMs ?? this.clock,
    });
    this.#emit('exit', { ...exit, timeMs: this.clock });
  }
}

/** Builds a minimal valid {@link SemanticSnapshot}. */
export function snapshot(
  revision: number,
  nodes: readonly SemanticNode[],
  sessionId = 't1',
): SemanticSnapshot {
  return {
    v: 1,
    sessionId,
    revision,
    columns: 80,
    rows: 24,
    rootIds: nodes.filter((node) => node.parentId === undefined).map((node) => node.id),
    nodes,
  };
}

/** Builds a semantic node with sane defaults. */
export function node(partial: Partial<SemanticNode> & Pick<SemanticNode, 'id' | 'role'>): SemanticNode {
  return { name: '', ...partial };
}
