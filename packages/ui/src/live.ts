/**
 * Live mode: a running session's events, translated into `§UI events`.
 *
 * The bridge subscribes to the same `SessionEvents` stream `@termwright/trace`
 * records from, so what the UI shows during a run and what the `.twtrace`
 * archive replays afterwards come from one source.
 *
 * @packageDocumentation
 */

import type { DiagnosticCode, SessionEvents } from '@termwright/driver';
import type { ProbeInfo, SemanticSnapshot } from '@termwright/protocol';
import { parseAppLog } from './app-log.js';
import { toBase64, type ServerMessage, type UiAdapterStatus } from './events.js';
import type { UiHub } from './hub.js';

/** Anything that can receive the session messages produced by this module. */
export interface UiSessionMessageSink {
  publish(message: ServerMessage): void;
}

/** Optional facts known by a worker but not by the terminal harness itself. */
export interface UiSessionStreamOptions {
  /** Vitest test driving this session, so live actions remain attributable. */
  readonly testId?: string;
  /** Innermost authored step at event time, supplied by the test fixture. */
  readonly currentStepId?: () => string | undefined;
}

/**
 * The part of a `TerminalHarness` the UI needs. Structural on purpose: fakes in
 * tests and `mountInk` sessions satisfy it without launching a PTY.
 */
export interface UiSessionSource {
  readonly sessionId: string;
  readonly events: SessionEvents;
  /**
   * Session facts the browser needs before the first byte arrives: the profile
   * decides how it measures characters, the viewport how it sizes the grid.
   * Required, not optional — a terminal built on a guess is a terminal that
   * disagrees with the session it is showing.
   */
  capabilities(): {
    readonly terminalProfile: string;
    readonly adapter?: { readonly name: string; readonly version: string };
    readonly probe?: ProbeInfo;
    readonly capabilities?: readonly string[];
  };
  screen(): { readonly columns: number; readonly rows: number };
  /** Current tree, when the session has an adapter. */
  semanticTree?(): SemanticSnapshot | null;
}

/**
 * Streams a session into the hub as `output`, `semantic`, `action` and
 * `app-log` messages.
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
  return streamSession(hub, source);
}

/**
 * Translates one session into the UI wire protocol and publishes it to a sink.
 *
 * The in-process server bridge and the worker WebSocket client both call this
 * function. Keeping the translation here means output, semantics, actions,
 * logs and adapter lifecycle cannot acquire subtly different wire shapes
 * depending on which side of a process boundary the session happened to run.
 */
export function streamSession(
  sink: UiSessionMessageSink,
  source: UiSessionSource,
  options: UiSessionStreamOptions = {},
): () => void {
  const sessionId = source.sessionId;
  let lastAdapter: { readonly name: string; readonly version: string } | undefined;
  let lastProbe: ProbeInfo | undefined;
  let lastCapabilities: readonly string[] | undefined;
  let lastStatus: UiAdapterStatus | undefined;

  /**
   * Publish state, not merely the launch-time guess. The driver deliberately
   * returns before semantic negotiation completes, so an `adapter-attached`
   * diagnostic is the point where ProbeInfo first becomes observable.
   */
  const announce = (nextStatus?: UiAdapterStatus): void => {
    const screen = source.screen();
    const capabilities = source.capabilities();
    if (capabilities.adapter !== undefined) lastAdapter = capabilities.adapter;
    if (capabilities.probe !== undefined && lastAdapter !== undefined) lastProbe = capabilities.probe;
    if (capabilities.capabilities !== undefined) lastCapabilities = capabilities.capabilities;
    if (nextStatus !== undefined && lastAdapter !== undefined) lastStatus = nextStatus;
    else if (lastAdapter !== undefined && lastStatus === undefined) lastStatus = 'attached';
    sink.publish({
      v: 1,
      type: 'session',
      sessionId,
      ...(options.testId === undefined ? {} : { testId: options.testId }),
      terminalProfile: capabilities.terminalProfile,
      ...(lastAdapter === undefined ? {} : { adapter: lastAdapter }),
      ...(lastProbe === undefined ? {} : { probe: lastProbe }),
      ...(lastCapabilities === undefined ? {} : { capabilities: lastCapabilities }),
      ...(lastStatus === undefined ? {} : { adapterStatus: lastStatus }),
      columns: screen.columns,
      rows: screen.rows,
    });
  };

  // Announced before any output: the browser builds its terminal from this.
  announce();
  const offOutput = source.events.on('output', ({ data, timeMs }) => {
    sink.publish({ v: 1, type: 'output', sessionId, dataB64: toBase64(data), t: timeMs });
  });
  const offSemantic = source.events.on('semantic-revision', ({ revision }) => {
    const snapshot = source.semanticTree?.() ?? null;
    if (snapshot === null || snapshot.revision !== revision) return;
    sink.publish({ v: 1, type: 'semantic', sessionId, revision, snapshot });
  });
  // Driver actions. The event fires *after* the action finished, so the output
  // it caused is already on the timeline ahead of it — the command log marks
  // when an action completed, never claims the bytes came after it.
  //
  // Failed actions are published too, and are the ones worth watching live: "the
  // click did not land because the app never enabled mouse reporting" beats
  // wondering why nothing happened.
  const offActionStart = source.events.on('action-start', (event) => {
    const stepId = options.currentStepId?.();
    sink.publish({
      v: 1,
      type: 'action-start',
      actionId: event.actionId,
      api: event.api,
      t: event.timeMs,
      sessionId,
      ...(options.testId === undefined ? {} : { testId: options.testId }),
      ...(event.selector === undefined ? {} : { selector: event.selector }),
      ...(stepId === undefined ? {} : { stepId }),
    });
  });
  const offAction = source.events.on('action', (event) => {
    const stepId = options.currentStepId?.();
    sink.publish({
      v: 1,
      type: 'action',
      actionId: event.actionId,
      kind: 'action',
      api: event.api,
      t: event.timeMs,
      ok: event.ok,
      sessionId,
      ...(options.testId === undefined ? {} : { testId: options.testId }),
      ...(event.selector === undefined ? {} : { selector: event.selector }),
      ...(event.ref === undefined ? {} : { ref: event.ref }),
      ...(event.error === undefined ? {} : { error: event.error }),
      ...(stepId === undefined ? {} : { stepId }),
    });
  });
  // Application logs: a followed file yields a line, an instrumented adapter a
  // structured record. Both flatten into one row; a payload that flattens to
  // nothing is dropped rather than published as an empty line.
  const offLog = source.events.on('app-log', (event) => {
    const log = parseAppLog(event);
    if (log === null) return;
    sink.publish({ v: 1, type: 'app-log', sessionId, ...log });
  });
  const lifecycle: Readonly<Partial<Record<DiagnosticCode, UiAdapterStatus>>> = {
    'adapter-attached': 'attached',
    'adapter-disconnected': 'disconnected',
    'protocol-violation': 'error',
    'endpoint-error': 'error',
  };
  const offDiagnostic = source.events.on('diagnostic', (event) => {
    const status = lifecycle[event.code];
    if (status === undefined) return;
    // A protocol/endpoint failure remains an error when the ensuing socket
    // close emits `adapter-disconnected`; do not make the badge look healthier.
    announce(lastStatus === 'error' && status === 'disconnected' ? 'error' : status);
  });
  return () => {
    offOutput();
    offSemantic();
    offActionStart();
    offAction();
    offLog();
    offDiagnostic();
  };
}
