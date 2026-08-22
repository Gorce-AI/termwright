/**
 * Live mode: a running session's events, translated into `§UI events`.
 *
 * The bridge subscribes to the same `SessionEvents` stream `@termwright/trace`
 * records from, so what the UI shows during a run and what the `.twtrace`
 * archive replays afterwards come from one source.
 *
 * @packageDocumentation
 */

import type { ActionabilityExplanation, DiagnosticCode, SessionEventRecord, SessionEvents } from '@termwright/driver';
import { projectSemanticSnapshotForArtifact, type EffectiveSessionContract, type SemanticSnapshot } from '@termwright/protocol';
import { parseAppLog } from './app-log.js';
import { toBase64, type ServerMessage, type UiActionability, type UiAdapterStatus } from './events.js';
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
  readonly terminalProfile: string;
  readonly events: SessionEvents;
  /**
   * Session facts the browser needs before the first byte arrives: the profile
   * decides how it measures characters, the viewport how it sizes the grid.
   * Required, not optional — a terminal built on a guess is a terminal that
   * disagrees with the session it is showing.
   */
  /** Frozen contract once semantic negotiation settles. */
  contract(): EffectiveSessionContract | null;
  screen(): { readonly columns: number; readonly rows: number };
  /** Current tree, when the session has an adapter. */
  semanticTree?(): SemanticSnapshot | null;
  /** Resolves the exact live Locator used by tests; never approximate this from node fields. */
  locatorForRef?(ref: string): {
    actionability(action: 'click' | 'hover' | 'focus' | 'type'): Promise<ActionabilityExplanation>;
  };
}

const INSPECTED_ACTIONS = ['click', 'hover', 'focus', 'type'] as const;

/**
 * Runs the production ActionPlanner for the four Inspector questions.
 *
 * A render between individual plans would make the panel combine different
 * worlds. Such a batch is rejected and the browser retries on the next live
 * revision; no diagnostic approximation is substituted.
 */
export async function inspectNodeActionability(
  source: UiSessionSource,
  nodeId: string,
): Promise<readonly UiActionability[]> {
  const snapshot = source.semanticTree?.();
  if (snapshot === null || snapshot === undefined) throw new Error('the live session has no committed semantic tree');
  if (!snapshot.nodes.some((node) => node.id === nodeId)) throw new Error(`semantic node ${nodeId} is not attached at revision ${snapshot.revision}`);
  if (source.locatorForRef === undefined) throw new Error('the live session does not expose production Locator actionability');
  const locator = source.locatorForRef(`semantic:${nodeId}@${snapshot.revision}`);
  const explanations = await Promise.all(INSPECTED_ACTIONS.map((action) => locator.actionability(action)));
  const checkpoint = explanations[0]?.checkpoint;
  if (checkpoint === undefined || explanations.some((entry) =>
    entry.checkpoint.contractId !== checkpoint.contractId || entry.checkpoint.sequence !== checkpoint.sequence
  )) throw new Error('the semantic observation changed while actionability was being inspected');
  return explanations.map(toUiActionability);
}

function toUiActionability(explanation: ActionabilityExplanation): UiActionability {
  return {
    actionable: explanation.actionable,
    kind: explanation.intent.kind,
    contractId: explanation.checkpoint.contractId,
    sequence: explanation.checkpoint.sequence,
    requirements: explanation.requirements.map((requirement) => ({
      kind: requirement.condition.kind,
      ...('target' in requirement.condition ? { target: requirement.condition.target } : {}),
      verdict: requirement.verdict,
      observation: requirement.observation.status,
      ...('evidence' in requirement.observation ? { evidence: requirement.observation.evidence } : {}),
    })),
    ...(explanation.strategy === undefined ? {} : { strategy: explanation.strategy }),
    ...(explanation.reason === undefined ? {} : { reason: explanation.reason }),
  };
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
  let lastStatus: UiAdapterStatus | undefined;

  /**
   * Publish state, not merely the launch-time guess. The driver deliberately
   * returns before semantic negotiation completes, so an `adapter-attached`
   * diagnostic is the point where ProbeInfo first becomes observable.
   */
  const announce = (nextStatus?: UiAdapterStatus): void => {
    const screen = source.screen();
    const contract = source.contract();
    if (nextStatus !== undefined && contract?.framework != null) lastStatus = nextStatus;
    else if (contract?.framework != null && lastStatus === undefined) lastStatus = 'attached';
    sink.publish({
      v: 1,
      type: 'session',
      sessionId,
      ...(options.testId === undefined ? {} : { testId: options.testId }),
      terminalProfile: source.terminalProfile,
      ...(contract === null ? {} : { contract }),
      ...(lastStatus === undefined ? {} : { adapterStatus: lastStatus }),
      columns: screen.columns,
      rows: screen.rows,
    });
  };

  // Announced before any output: the browser builds its terminal from this.
  announce();
  const lifecycle: Readonly<Partial<Record<DiagnosticCode, UiAdapterStatus>>> = {
    'adapter-attached': 'attached',
    'adapter-disconnected': 'disconnected',
    'protocol-violation': 'error',
    'endpoint-error': 'error',
  };

  const consume = (recorded: SessionEventRecord): void => {
    switch (recorded.type) {
    case 'output': {
      const { data, timeMs } = recorded.payload;
    sink.publish({ v: 1, type: 'output', sessionId, dataB64: toBase64(data), t: timeMs });
      break;
    }
    case 'semantic-revision': {
      const { revision, snapshot } = recorded.payload;
      if (snapshot.revision !== revision) break;
      sink.publish({ v: 1, type: 'semantic', sessionId, revision, snapshot: projectSemanticSnapshotForArtifact(snapshot) });
      break;
    }
  // Driver actions. The event fires *after* the action finished, so the output
  // it caused is already on the timeline ahead of it — the command log marks
  // when an action completed, never claims the bytes came after it.
  //
  // Failed actions are published too, and are the ones worth watching live: "the
  // click did not land because the app never enabled mouse reporting" beats
  // wondering why nothing happened.
    case 'action-start': {
      const event = recorded.payload;
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
      break;
    }
    case 'action': {
      const event = recorded.payload;
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
      ...(event.receipt === undefined ? {} : {
        actionPlan: {
          actionId: event.receipt.plan.actionId,
          kind: event.receipt.intent.kind,
          strategy: event.receipt.plan.strategy,
          contractId: event.receipt.plan.contractId,
          beforeSequence: event.receipt.before.sequence,
          afterSequence: event.receipt.after.sequence,
          operations: event.receipt.executed.map((operation) => ({
            device: operation.device,
            kind: operation.kind,
            ...(operation.device === 'mouse' && operation.modifiers !== undefined ? { modifiers: operation.modifiers } : {}),
          })),
          requirements: event.receipt.plan.requirements.map((requirement) => ({
            kind: requirement.condition.kind,
            ...('target' in requirement.condition ? { target: requirement.condition.target } : {}),
            verdict: requirement.verdict,
            observation: requirement.observation.status,
            ...('evidence' in requirement.observation ? { evidence: requirement.observation.evidence } : {}),
          })),
          ...(event.receipt.plan.physicalRegion === undefined
            ? {}
            : { physicalEvidence: event.receipt.plan.physicalRegion.evidence }),
        },
      }),
      ...(event.actionability === undefined ? {} : { actionability: toUiActionability(event.actionability) }),
      ...(stepId === undefined ? {} : { stepId }),
    });
      break;
    }
  // Application logs: a followed file yields a line, an instrumented adapter a
  // structured record. Both flatten into one row; a payload that flattens to
  // nothing is dropped rather than published as an empty line.
    case 'app-log': {
      const event = recorded.payload;
    const log = parseAppLog(event);
      if (log !== null) sink.publish({ v: 1, type: 'app-log', sessionId, ...log });
      break;
    }
    case 'diagnostic': {
      const event = recorded.payload;
    const status = lifecycle[event.code];
      if (status === undefined) break;
    // A protocol/endpoint failure remains an error when the ensuing socket
    // close emits `adapter-disconnected`; do not make the badge look healthier.
    announce(lastStatus === 'error' && status === 'disconnected' ? 'error' : status);
      break;
    }
    case 'crash':
    case 'exit':
    case 'input':
    case 'resize':
    case 'screen-revision':
      break;
    }
  };

  return source.events.subscribe({
    fromSequence: 1,
    onGap: (gap) => sink.publish({
      v: 1,
      type: 'diagnostic-gap',
      source: 'live-session-producer',
      droppedMessages: gap.lostEvents,
      droppedBytes: gap.lostBytes,
    }),
  }, consume);
}
