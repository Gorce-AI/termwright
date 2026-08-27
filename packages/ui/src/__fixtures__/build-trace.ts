/**
 * Builds a real `.twtrace` archive with the trace writer, so the time-travel
 * tests exercise the format rather than a stand-in for it.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTraceWriter } from '@termwright/trace';
import type { NodeGeometryObservations, Rect, SemanticSnapshot } from '@termwright/protocol';
import type { SessionEventMap, SessionEventRecord, SessionEvents } from '@termwright/driver';

type Listener = (payload: never) => void;

class Recorded {
  readonly sessionId = 'trace-session';
  readonly #listeners = new Map<keyof SessionEventMap, Set<Listener>>();
  readonly #journalListeners = new Set<(record: SessionEventRecord) => void>();
  readonly #journal: SessionEventRecord[] = [];
  #sequence = 0;
  #tree: SemanticSnapshot | null = null;
  clock = 0;

  readonly now = (): number => this.clock;

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
    checkpoint: () => this.#sequence,
    subscribe: (options, callback) => {
      for (const record of this.#journal) {
        if (record.sequence >= options.fromSequence) callback(record);
      }
      this.#journalListeners.add(callback);
      return () => this.#journalListeners.delete(callback);
    },
  };

  semanticTree(): SemanticSnapshot | null {
    return this.#tree;
  }

  emit<E extends keyof SessionEventMap>(event: E, payload: SessionEventMap[E]): void {
    const record = { sequence: ++this.#sequence, type: event, payload } as SessionEventRecord;
    this.#journal.push(record);
    for (const listener of this.#journalListeners) listener(record);
    for (const listener of this.#listeners.get(event) ?? []) {
      (listener as (value: SessionEventMap[E]) => void)(payload);
    }
  }

  publish(tree: SemanticSnapshot): void {
    this.#tree = tree;
    this.emit('semantic-revision', { revision: tree.revision, timeMs: this.clock, snapshot: tree });
  }
}

const unknownGeometry = (): NodeGeometryObservations => ({
  displayed: { status: 'unknown', reason: 'awaiting-revision-pair' },
  intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
  visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
});

const visibleGeometry = (rect: Rect): NodeGeometryObservations => ({
  displayed: {
    status: 'known',
    value: true,
    evidence: {
      source: 'framework',
      method: 'native',
      strength: 'authoritative',
      providerId: 'ui-fixture',
    },
  },
  intendedRect: {
    status: 'known',
    value: { ...rect },
    evidence: {
      source: 'framework',
      method: 'native',
      strength: 'authoritative',
      providerId: 'ui-fixture',
    },
  },
  visibleRect: {
    status: 'known',
    value: { ...rect },
    evidence: {
      source: 'framework',
      method: 'native',
      strength: 'authoritative',
      providerId: 'ui-fixture',
    },
  },
});

const snapshotFacts = {
  coordinateSpace: { status: 'unknown' as const, reason: 'awaiting-revision-pair' as const },
  hitGrid: {
    status: 'unsupported' as const,
    capability: 'pointer-hit-grid',
    reason: 'framework-unobservable' as const,
  },
};

/** The tree published at each of the fixture's two revisions. */
export const FIXTURE_TREES: readonly SemanticSnapshot[] = [
  {
    v: 2,
    sessionId: 'trace-session',
    revision: 1,
    columns: 80,
    rows: 24,
    rootIds: ['d1'],
    nodes: [
      {
        id: 'd1',
        role: 'dialog',
        name: 'Permission',
        state: { modal: true },
        geometry: unknownGeometry(),
      },
      {
        id: 'b1',
        role: 'button',
        name: 'Approve',
        parentId: 'd1',
        geometry: visibleGeometry({ row: 3, column: 4, width: 9, height: 1 }),
      },
    ],
    ...snapshotFacts,
  },
  {
    v: 2,
    sessionId: 'trace-session',
    revision: 2,
    columns: 80,
    rows: 24,
    rootIds: ['s1'],
    nodes: [{ id: 's1', role: 'status', name: 'running: ls -la', geometry: unknownGeometry() }],
    ...snapshotFacts,
  },
];

/**
 * Writes a two-step archive: output at 0 ms, a tree, a step around a second
 * chunk of output, a second tree, and an exit.
 *
 * @returns the archive directory.
 */
export async function buildFixtureTrace(
  options: { readonly columns?: number; readonly rows?: number } = {},
): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'termwright-ui-')), 'session.twtrace');
  const session = new Recorded();
  const columns = options.columns ?? 80;
  const rows = options.rows ?? 24;
  const writer = createTraceWriter(session, {
    dir,
    command: ['node', 'agent.js'],
    columns,
    rows,
    now: session.now,
  });

  session.emit('output', { data: new TextEncoder().encode('Permission required\r\n'), timeMs: 0 });
  session.publish({ ...(FIXTURE_TREES[0] as SemanticSnapshot), columns, rows });
  session.clock = 100;
  writer.recordAction({ api: 'locator.click', selector: 'button', ref: 'semantic:b1@1', ok: true });

  session.emit('app-log', {
    source: 'file',
    label: 'server.log',
    line: 'listening on 3000',
    timeMs: 0,
  });

  session.clock = 1_000;
  const step = writer.addStep('approve');
  session.emit('output', { data: new TextEncoder().encode('running: ls -la\r\n'), timeMs: 1_000 });
  session.emit('app-log', {
    source: 'adapter',
    timeMs: 1_050,
    record: {
      ts: 1_700_000_000_000,
      seq: 1,
      level: 'warn',
      message: 'pool exhausted',
      logger: 'db.pool',
      attrs: { size: 10 },
    },
  });

  session.clock = 1_500;
  session.publish({ ...(FIXTURE_TREES[1] as SemanticSnapshot), columns, rows });
  step.end('passed');

  session.clock = 2_000;
  session.emit('exit', { code: 0, signal: null, timeMs: 2_000 });
  await writer.finalize();
  return dir;
}

/**
 * Writes an archive of a session that died on its own: output, a tree, then a
 * `crash` event followed by the exit — the order the driver emits them in, so
 * the writer stamps `meta.crash.castOffset` the way it does in a real run.
 *
 * @returns the archive directory.
 */
export async function buildCrashedFixtureTrace(): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'termwright-ui-crash-')), 'crashed.twtrace');
  const session = new Recorded();
  const writer = createTraceWriter(session, {
    dir,
    command: ['node', 'agent.js'],
    columns: 80,
    rows: 24,
    now: session.now,
  });

  session.emit('output', { data: new TextEncoder().encode('starting\r\n'), timeMs: 0 });
  session.publish(FIXTURE_TREES[0] as SemanticSnapshot);

  session.clock = 1_200;
  session.emit('output', {
    data: new TextEncoder().encode('panic: runtime error: index out of range\r\n'),
    timeMs: 1_200,
  });

  session.clock = 1_400;
  session.emit('crash', {
    exit: { code: null, signal: 'SIGSEGV' },
    screenTail: ['starting', 'panic: runtime error: index out of range'],
    lastSemanticTree: FIXTURE_TREES[0] as SemanticSnapshot,
    recentInputs: [
      { timeMs: 1_100, kind: 'key', bytes: 1, preview: '\\r' },
      { timeMs: 1_150, kind: 'paste', bytes: 64 },
    ],
    diagnosticsTail: [
      { code: 'protocol-violation', detail: 'frame too large', revision: 1, timeMs: 1_300 },
    ],
    timeMs: 1_400,
  });
  session.emit('exit', { code: null, signal: 'SIGSEGV', timeMs: 1_400 });

  await writer.finalize();
  return dir;
}
