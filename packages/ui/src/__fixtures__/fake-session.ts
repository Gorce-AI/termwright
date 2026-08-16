/**
 * In-memory stand-ins for a live session, used by this package's tests. Never
 * exported from `src/index.ts`; nothing here ships.
 */

import type { SessionEventMap, SessionEvents, TerminalHarness } from '@termwright/driver';
import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import type { UiSessionSource } from '../live.js';

type Listener = (payload: never) => void;

/** A session whose event stream the test drives by hand. */
export class FakeSession implements UiSessionSource {
  readonly sessionId: string;
  readonly #listeners = new Map<keyof SessionEventMap, Set<Listener>>();
  #tree: SemanticSnapshot | null = null;
  clock = 0;

  constructor(sessionId = 's1') {
    this.sessionId = sessionId;
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

  output(text: string): void {
    this.#emit('output', { data: new TextEncoder().encode(text), timeMs: this.clock });
  }

  /** Publishes a tree and announces its revision. */
  semantic(snapshot: SemanticSnapshot): void {
    this.#tree = snapshot;
    this.#emit('semantic-revision', { revision: snapshot.revision, timeMs: this.clock });
  }

  /** Emits a followed-file log line. */
  logLine(line: string, label = 'server.log'): void {
    this.#emit('app-log', { source: 'file', label, line, timeMs: this.clock });
  }

  /** Emits a structured record from an instrumented adapter. */
  logRecord(record: {
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    message: string;
    logger?: string;
    seq?: number;
    attrs?: Record<string, string | number | boolean | null>;
  }): void {
    this.#emit('app-log', {
      source: 'adapter',
      record: { ts: Date.now(), seq: record.seq ?? 1, ...record },
      timeMs: this.clock,
    });
  }

  /** Announces a revision the session has not caught up to yet. */
  announceRevision(revision: number): void {
    this.#emit('semantic-revision', { revision, timeMs: this.clock });
  }

  #emit<E extends keyof SessionEventMap>(event: E, payload: SessionEventMap[E]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      (listener as (value: SessionEventMap[E]) => void)(payload);
    }
  }
}

/**
 * A `TerminalHarness` with only the parts the recorder touches implemented.
 * Everything else throws, so a test that starts depending on more than the
 * recorder's real surface fails loudly instead of silently passing.
 */
export class FakeHarness extends FakeSession {
  /** Every byte the recorder forwarded to the child. */
  readonly written: Uint8Array[] = [];
  closed = false;

  async write(bytes: Uint8Array | string): Promise<void> {
    this.written.push(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
  }

  screen(): { columns: number; rows: number } {
    return { columns: 80, rows: 24 };
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Concatenation of everything written, as text. */
  writtenText(): string {
    return this.written.map((chunk) => new TextDecoder().decode(chunk)).join('');
  }

  /** The harness view the recorder and the server take. */
  asHarness(): TerminalHarness {
    return this as unknown as TerminalHarness;
  }
}

/** Builds a minimal valid snapshot. */
export function snapshot(
  revision: number,
  nodes: readonly SemanticNode[],
  sessionId = 's1',
): SemanticSnapshot {
  return {
    v: 1,
    sessionId,
    revision,
    columns: 80,
    rows: 24,
    rootIds: nodes.filter((item) => item.parentId === undefined).map((item) => item.id),
    nodes,
  };
}

/** Builds a semantic node with sane defaults. */
export function node(
  partial: Partial<SemanticNode> & Pick<SemanticNode, 'id' | 'role'>,
): SemanticNode {
  return { name: '', ...partial };
}
