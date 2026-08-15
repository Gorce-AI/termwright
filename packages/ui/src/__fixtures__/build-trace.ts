/**
 * Builds a real `.twtrace` archive with the trace writer, so the time-travel
 * tests exercise the format rather than a stand-in for it.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTraceWriter } from '@termwright/trace';
import type { SemanticSnapshot } from '@termwright/protocol';
import type { SessionEventMap, SessionEvents } from '@termwright/driver';

type Listener = (payload: never) => void;

class Recorded {
  readonly sessionId = 'trace-session';
  readonly #listeners = new Map<keyof SessionEventMap, Set<Listener>>();
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
  };

  semanticTree(): SemanticSnapshot | null {
    return this.#tree;
  }

  emit<E extends keyof SessionEventMap>(event: E, payload: SessionEventMap[E]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      (listener as (value: SessionEventMap[E]) => void)(payload);
    }
  }

  publish(tree: SemanticSnapshot): void {
    this.#tree = tree;
    this.emit('semantic-revision', { revision: tree.revision, timeMs: this.clock });
  }
}

/** The tree published at each of the fixture's two revisions. */
export const FIXTURE_TREES: readonly SemanticSnapshot[] = [
  {
    v: 1,
    sessionId: 'trace-session',
    revision: 1,
    columns: 80,
    rows: 24,
    rootIds: ['d1'],
    nodes: [
      { id: 'd1', role: 'dialog', name: 'Permission', state: { modal: true } },
      { id: 'b1', role: 'button', name: 'Approve', parentId: 'd1', bounds: { row: 3, column: 4, width: 9, height: 1 } },
    ],
  },
  {
    v: 1,
    sessionId: 'trace-session',
    revision: 2,
    columns: 80,
    rows: 24,
    rootIds: ['s1'],
    nodes: [{ id: 's1', role: 'status', name: 'running: ls -la' }],
  },
];

/**
 * Writes a two-step archive: output at 0 ms, a tree, a step around a second
 * chunk of output, a second tree, and an exit.
 *
 * @returns the archive directory.
 */
export async function buildFixtureTrace(): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'termwright-ui-')), 'session.twtrace');
  const session = new Recorded();
  const writer = createTraceWriter(session, {
    dir,
    command: ['node', 'agent.js'],
    columns: 80,
    rows: 24,
    now: session.now,
  });

  session.emit('output', { data: new TextEncoder().encode('Permission required\r\n'), timeMs: 0 });
  session.publish(FIXTURE_TREES[0] as SemanticSnapshot);

  session.clock = 1_000;
  const step = writer.addStep('approve');
  session.emit('output', { data: new TextEncoder().encode('running: ls -la\r\n'), timeMs: 1_000 });
  session.clock = 1_500;
  session.publish(FIXTURE_TREES[1] as SemanticSnapshot);
  step.end('passed');

  session.clock = 2_000;
  session.emit('exit', { code: 0, signal: null, timeMs: 2_000 });
  await writer.finalize();
  return dir;
}
