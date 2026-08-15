/**
 * In-memory stand-in for a `TerminalHarness`, used by the package's own tests.
 * Not exported from `src/index.ts` — it never ships.
 */

import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import type { SessionEventMap, SessionEvents } from '@termwright/driver';
import type { TraceSource } from '../writer.js';

type Listener = (payload: never) => void;

/** A session whose clock and event stream the test drives by hand. */
export class FakeSession implements TraceSource {
  readonly sessionId: string;
  #listeners = new Map<keyof SessionEventMap, Set<Listener>>();
  #tree: SemanticSnapshot | null = null;
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

  exit(code: number | null, signal: string | null = null): void {
    this.#emit('exit', { code, signal, timeMs: this.clock });
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
