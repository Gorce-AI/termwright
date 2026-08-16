/**
 * Live mode: a running session's events, translated into `§UI events`.
 *
 * The bridge subscribes to the same `SessionEvents` stream `@termwright/trace`
 * records from, so what the UI shows during a run and what the `.twtrace`
 * archive replays afterwards come from one source.
 *
 * @packageDocumentation
 */

import type { SessionEvents } from '@termwright/driver';
import type { SemanticSnapshot } from '@termwright/protocol';
import { parseAppLog } from './app-log.js';
import { toBase64 } from './events.js';
import type { UiHub } from './hub.js';

/**
 * The part of a `TerminalHarness` the UI needs. Structural on purpose: fakes in
 * tests and `mountInk` sessions satisfy it without launching a PTY.
 */
export interface UiSessionSource {
  readonly sessionId: string;
  readonly events: SessionEvents;
  /** Current tree, when the session has an adapter. */
  semanticTree?(): SemanticSnapshot | null;
}

/**
 * Streams a session into the hub as `output` and `semantic` messages.
 *
 * A `semantic-revision` event only announces that a tree exists; the tree itself
 * is read back from the session. When the harness has not caught up yet — the
 * revision it holds is older than the one announced — the message is skipped
 * rather than sent stale: the next revision brings a consistent pair, and a
 * mislabelled tree would misplace every overlay drawn from it.
 *
 * @returns a function that detaches from the session.
 *
 * @example
 * ```ts
 * const detach = attachSession(server.hub, harness);
 * ```
 */
export function attachSession(hub: UiHub, source: UiSessionSource): () => void {
  const sessionId = source.sessionId;
  const offOutput = source.events.on('output', ({ data, timeMs }) => {
    hub.publish({ v: 1, type: 'output', sessionId, dataB64: toBase64(data), t: timeMs });
  });
  const offSemantic = source.events.on('semantic-revision', ({ revision }) => {
    const snapshot = source.semanticTree?.() ?? null;
    if (snapshot === null || snapshot.revision !== revision) return;
    hub.publish({ v: 1, type: 'semantic', sessionId, revision, snapshot });
  });
  // Application logs: a followed file yields a line, an instrumented adapter a
  // structured record. Both flatten into one row; a payload that flattens to
  // nothing is dropped rather than published as an empty line.
  const offLog = source.events.on('app-log', (event) => {
    const log = parseAppLog(event);
    if (log === null) return;
    hub.publish({ v: 1, type: 'app-log', sessionId, ...log });
  });
  return () => {
    offOutput();
    offSemantic();
    offLog();
  };
}
