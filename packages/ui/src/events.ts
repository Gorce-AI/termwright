/**
 * The `§UI events` wire protocol from `/CONTRACTS.md`: the JSON messages the
 * runner server and the browser app exchange over one WebSocket.
 *
 * The protocol is deliberately tiny. Everything that is *state* rather than an
 * *event* — the session list, the opened trace, a point on the time-travel
 * timeline — is fetched over HTTP instead (see `server.ts`), so this file stays
 * a one-to-one transcription of the contract.
 *
 * Both directions are validated on arrival: a browser tab and an attached
 * session producer are untrusted inputs. Native test lifecycle is projected
 * from the host journal in process, not recovered from reporter output.
 *
 * @packageDocumentation
 */

import type {
  EffectiveSessionContract,
  EvidenceProvenance,
  SemanticSnapshot,
} from '@termwright/protocol';
import {
  EVIDENCE_PROVIDER_CAPABILITIES,
  SESSION_CAPABILITIES,
} from '@termwright/protocol/contract';
import { CONDITION_KINDS } from '@termwright/protocol/action-model';
import type { LocatorRef } from '@termwright/driver';
import { parseAppLog, type AppLogView } from './app-log.js';
import type {
  DiscoveredTest,
  DiscoveredTestAncestor,
  DiscoveredTestKind,
  DiscoveredTestSource,
} from './discovery.js';

/** Protocol version carried by every message. */
export const UI_PROTOCOL_VERSION = 1;

/** Outcome of a test, as the timeline pane shows it. */
export type UiTestStatus = 'passed' | 'failed' | 'skipped';

/** A failed native Vitest attempt preceding the final case result. */
export interface UiPriorFailure {
  readonly attempt: number;
  readonly errors: readonly string[];
}

/** Whether a `step` message opens or closes a step. */
export type UiStepPhase = 'start' | 'end';

/** Physical Gherkin prose attached to a native Termwright step. */
export interface UiGherkinStep {
  readonly keyword: string;
  readonly text: string;
  readonly source: { readonly file: string; readonly line: number; readonly column: number };
  readonly background?: boolean;
}

/** Counters closing a run. */
export interface UiRunSummary {
  /** Canonical terminal verdict; counters alone cannot represent declarative skips. */
  readonly verdict: 'passed' | 'passed-with-skips' | 'failed' | 'flaky' | 'skipped' | 'cancelled' | 'crashed' | 'infrastructure-failed' | 'incomplete';
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  /**
   * Tests that passed only after a retry. Counted separately from `passed`
   * because a flaky test is a different problem from a working one, and
   * burying it in the pass count is how it stays broken.
   */
  readonly flaky: number;
  /** Wall-clock duration of the run, in milliseconds. */
  readonly durationMs: number;
}

/** What the server is doing: watching a run, replaying a trace, or recording. */
export type UiServerMode = 'live' | 'post-mortem' | 'record';

/** Last known state of the semantic adapter connection. */
export type UiAdapterStatus = 'attached' | 'disconnected' | 'error';

/** Exact projection of the driver's ActionReceipt for live Runner diagnostics. */
export interface UiActionRequirement {
  readonly kind: string;
  readonly target?: string;
  readonly verdict: 'satisfied' | 'unsatisfied' | 'inconclusive';
  readonly observation: 'known' | 'absent' | 'unknown' | 'unsupported';
  readonly evidence?: EvidenceProvenance;
}

export interface UiActionPlan {
  readonly actionId: string;
  readonly kind: string;
  readonly strategy: string;
  readonly contractId: string;
  readonly beforeSequence: number;
  readonly afterSequence: number;
  readonly operations: readonly {
    readonly device: 'keyboard' | 'mouse';
    readonly kind: string;
    readonly modifiers?: readonly ('shift' | 'alt' | 'control')[];
  }[];
  readonly requirements: readonly UiActionRequirement[];
  readonly physicalEvidence?: EvidenceProvenance;
}

export interface UiActionability {
  readonly actionable: boolean;
  readonly kind: string;
  readonly contractId: string;
  readonly sequence: number;
  readonly requirements: readonly UiActionRequirement[];
  readonly strategy?: string;
  readonly reason?: { readonly code: string; readonly message: string; readonly targetRef?: LocatorRef };
}

/** server → client. */
export type ServerMessage =
  | {
      readonly v: 1;
      readonly type: 'tests-discovered';
      /**
       * Every test the project holds, before anything runs. `id` is the
       * invocation-scoped RunnerTaskId from native Vitest collection. File
       * and title are display data and never execution identity.
       */
      readonly tests: readonly DiscoveredTest[];
    }
  | { readonly v: 1; readonly type: 'collection-failed'; readonly error: string }
  | {
      readonly v: 1;
      readonly type: 'session';
      readonly sessionId: string;
      /** Vitest test which launched this worker-side session, when known. */
      readonly testId?: string;
      /**
       * Terminal profile the session runs with. The browser has to measure
       * characters the way the session does, or say which widths it used —
       * a frame that lands a column apart with nothing to explain it is the
       * expensive kind of wrong.
       */
      readonly terminalProfile: string;
      /** Frozen, negotiated public contract used by Locator and ActionPlanner. */
      readonly contract?: EffectiveSessionContract;
      readonly adapterStatus?: UiAdapterStatus;
      readonly columns: number;
      readonly rows: number;
    }
  | { readonly v: 1; readonly type: 'run-start'; readonly runId: string; readonly mode: UiServerMode; readonly startedAt: number }
  | {
      readonly v: 1;
      readonly type: 'test-start';
      readonly id: string;
      /** Native catalogue identity; absent only for recorder pseudo-cases. */
      readonly runnerTaskId?: string;
      readonly executionId?: string;
      readonly attempt?: number;
      readonly title: string;
      readonly file: string;
      /**
       * Unix epoch milliseconds when the test started. A tab that connects
       * mid-run replays the backlog and needs this to show a truthful elapsed
       * time; without it, every running test would look like it just began.
       */
      readonly startedAt: number;
      /**
       * Session this attempt drives. Optional because an attempt may launch no
       * terminal or several; ownership is also carried by `session.testId`.
       */
      readonly sessionId?: string;
    }
  | {
      readonly v: 1;
      readonly type: 'step';
      readonly testId: string;
      readonly title: string;
      readonly phase: UiStepPhase;
      /** Step id, when the producer has one; lets nested steps pair up. */
      readonly stepId?: string;
      /** Milliseconds on the producer's timeline. */
      readonly t?: number;
      readonly status?: 'passed' | 'failed';
      readonly error?: string;
      readonly gherkin?: UiGherkinStep;
    }
  | {
      readonly v: 1;
      readonly type: 'output';
      readonly sessionId: string;
      /** Base64 of the raw PTY bytes — the wire is JSON, the terminal is not. */
      readonly dataB64: string;
      readonly t: number;
    }
  | {
      readonly v: 1;
      readonly type: 'semantic';
      readonly sessionId: string;
      readonly revision: number;
      readonly snapshot: SemanticSnapshot;
    }
  | {
      readonly v: 1;
      readonly type: 'test-end';
      readonly id: string;
      readonly status: UiTestStatus;
      /** How long the test took, in milliseconds. */
      readonly durationMs: number;
      /** Passed only after a retry — a different problem from a failure. */
      readonly flaky: boolean;
      /**
       * Application log records the harness could not keep; `0` when none were
       * dropped. Required: "nothing was lost" and "nobody counted" are
       * different facts, and only one of them is reassuring.
       */
      readonly lostLogRecords: number;
      /** Absent when no archive was retained for this test. */
      readonly traceRef?: string;
      /** Absent on a pass. */
      readonly error?: string;
      /** One-based final attempt number. Absent for pre-retry producers. */
      readonly attempt?: number;
      readonly priorFailures?: readonly UiPriorFailure[];
    }
  | { readonly v: 1; readonly type: 'run-end'; readonly summary: UiRunSummary }
  | { readonly v: 1; readonly type: 'run-cancelled'; readonly stoppedAt: number }
  | { readonly v: 1; readonly type: 'run-cancel-failed'; readonly error: string }
  | { readonly v: 1; readonly type: 'run-infrastructure-failed'; readonly runId: string; readonly error: string }
  | {
      readonly v: 1;
      readonly type: 'diagnostic-gap';
      readonly source: 'ui-hub' | 'live-session-producer';
      readonly droppedMessages: number;
      readonly droppedBytes: number;
    }
  | ({
      readonly v: 1;
      readonly type: 'app-log';
      readonly sessionId: string;
    } & AppLogView)
  | {
      readonly v: 1;
      readonly type: 'action-start';
      /** Session-local id, paired with the eventual `action` message. */
      readonly actionId: string;
      readonly api: string;
      readonly t: number;
      readonly testId?: string;
      readonly sessionId?: string;
      readonly selector?: string;
      readonly stepId?: string;
    }
  | {
      readonly v: 1;
      readonly type: 'action';
      /** `action` for a driver call, `assert` for an expectation. */
      readonly kind: 'action' | 'assert';
      /** Driver API name, e.g. `locator.click`, or the matcher's name. */
      readonly api: string;
      /** Present for driver actions with a live start edge. */
      readonly actionId?: string;
      /** Milliseconds on the session clock. */
      readonly t: number;
      readonly ok: boolean;
      readonly testId?: string;
      readonly sessionId?: string;
      readonly selector?: string;
      /** Domain-tagged resolved target ref, `semantic:n8@42`. */
      readonly ref?: LocatorRef;
      readonly error?: string;
      readonly actionPlan?: UiActionPlan;
      readonly actionability?: UiActionability;
      readonly stepId?: string;
    }
  | {
      readonly v: 1;
      readonly type: 'actionability-inspection';
      readonly requestId: string;
      readonly sessionId: string;
      readonly nodeId: string;
      readonly results?: readonly UiActionability[];
      readonly error?: string;
    }
  | {
      readonly v: 1;
      readonly type: 'control-result';
      readonly requestId: string;
      readonly control: 'pick' | 'input';
      readonly ok: boolean;
      readonly error?: string;
    };

/** client → server. */
export type ClientMessage =
  | { readonly v: 1; readonly type: 'pick'; readonly sessionId: string; readonly enabled?: boolean; readonly requestId?: string }
  | { readonly v: 1; readonly type: 'input'; readonly sessionId: string; readonly dataB64: string; readonly requestId?: string }
  | { readonly v: 1; readonly type: 'inspect-actionability'; readonly requestId: string; readonly sessionId: string; readonly nodeId: string };

/** Any message on the socket, in either direction. */
export type UiMessage = ServerMessage | ClientMessage;

const SERVER_TYPES = new Set([
  'tests-discovered',
  'collection-failed',
  'session',
  'run-start',
  'test-start',
  'step',
  'output',
  'semantic',
  'test-end',
  'run-end',
  'run-cancelled',
  'run-cancel-failed',
  'run-infrastructure-failed',
  'diagnostic-gap',
  'app-log',
  'action-start',
  'action',
  'actionability-inspection',
  'control-result',
]);
const CLIENT_TYPES = new Set(['pick', 'input', 'inspect-actionability']);

/** Thrown by {@link parseClientMessage} and {@link parseServerMessage}. */
export class UiProtocolError extends Error {
  override readonly name = 'UiProtocolError';
}

/**
 * Encodes a message for the socket.
 *
 * @example
 * ```ts
 * socket.send(encodeMessage({ v: 1, type: 'pick', sessionId: 'session:…' }));
 * ```
 */
export function encodeMessage(message: UiMessage): string {
  return JSON.stringify(message);
}

/**
 * Base64 of raw bytes, for `output` and `input` payloads.
 *
 * This module is imported by the browser app as well as by the server, so the
 * conversions go through `Buffer` on Node and `btoa`/`atob` in a page.
 */
export function toBase64(data: Uint8Array): string {
  const buffer = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (buffer !== undefined) return buffer.from(data).toString('base64');
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Inverse of {@link toBase64}. */
export function fromBase64(data: string): Uint8Array {
  const buffer = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (buffer !== undefined) return new Uint8Array(buffer.from(data, 'base64'));
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Parses and validates a client→server message.
 *
 * @throws UiProtocolError when the payload is not a well-formed message of a
 *   known client type. Unknown types are rejected rather than ignored: a typo in
 *   a message that silently does nothing is the hardest kind of bug to see.
 */
export function parseClientMessage(raw: string | Uint8Array): ClientMessage {
  const value = parseEnvelope(raw, CLIENT_TYPES);
  switch (value.type) {
    case 'pick': {
      const enabled = value['enabled'];
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        throw new UiProtocolError('pick: enabled must be a boolean');
      }
      return {
        v: 1,
        type: 'pick',
        sessionId: requireString(value, 'sessionId', 'pick'),
        ...(enabled === undefined ? {} : { enabled }),
        ...(value['requestId'] === undefined
          ? {}
          : { requestId: requireBoundedString(value, 'requestId', 'pick') }),
      };
    }
    case 'input':
      return {
        v: 1,
        type: 'input',
        sessionId: requireString(value, 'sessionId', 'input'),
        dataB64: requireBase64(value, 'dataB64', 'input'),
        ...(value['requestId'] === undefined
          ? {}
          : { requestId: requireBoundedString(value, 'requestId', 'input') }),
      };
    case 'inspect-actionability':
      return {
        v: 1,
        type: 'inspect-actionability',
        requestId: requireBoundedString(value, 'requestId', 'inspect-actionability'),
        sessionId: requireBoundedString(value, 'sessionId', 'inspect-actionability'),
        nodeId: requireBoundedString(value, 'nodeId', 'inspect-actionability'),
      };
    default:
      throw new UiProtocolError(`unknown client message type: ${String(value.type)}`);
  }
}

/**
 * Parses and validates a server→client message. Used by the browser app and by
 * the server itself when an attached session feeds it messages over a socket.
 *
 * @throws UiProtocolError for malformed or unknown-typed payloads.
 */
export function parseServerMessage(raw: string | Uint8Array): ServerMessage {
  const value = parseEnvelope(raw, SERVER_TYPES);
  switch (value.type) {
    case 'tests-discovered': {
      const tests = value['tests'];
      if (!Array.isArray(tests)) throw new UiProtocolError('tests-discovered: tests must be an array');
      return {
        v: 1,
        type: 'tests-discovered',
        tests: tests.map((entry, index) => {
          if (typeof entry !== 'object' || entry === null) {
            throw new UiProtocolError(`tests-discovered: tests[${index}] must be an object`);
          }
          const test = entry as Record<string, unknown>;
          const context = `tests-discovered.tests[${index}]`;
          const provider = parseDiscoveredProvider(test['provider'], context);
          const kind = parseDiscoveredKind(test['kind'], context);
          const ancestors = parseDiscoveredAncestors(test['ancestors'], context);
          const tags = parseDiscoveredTags(test['tags'], context);
          const source = parseDiscoveredSource(test['source'], context);
          return {
            id: requireString(test, 'id', `tests-discovered.tests[${index}]`),
            title: requireString(test, 'title', `tests-discovered.tests[${index}]`),
            file: requireString(test, 'file', `tests-discovered.tests[${index}]`),
            ...(provider === undefined ? {} : { provider }),
            ...(kind === undefined ? {} : { kind }),
            ...(ancestors === undefined ? {} : { ancestors }),
            ...(tags === undefined ? {} : { tags }),
            ...(source === undefined ? {} : { source }),
          };
        }),
      };
    }
    case 'collection-failed':
      return { v: 1, type: 'collection-failed', error: requireBoundedString(value, 'error', 'collection-failed') };
    case 'session': {
      for (const removedField of ['adapter', 'probe', 'capabilities'] as const) {
        if (value[removedField] !== undefined) {
          throw new UiProtocolError(
            `session: ${removedField} is not a protocol field; use the frozen contract`,
          );
        }
      }
      const adapterStatus = value['adapterStatus'];
      if (
        adapterStatus !== undefined &&
        adapterStatus !== 'attached' &&
        adapterStatus !== 'disconnected' &&
        adapterStatus !== 'error'
      ) {
        throw new UiProtocolError('session: adapterStatus is invalid');
      }
      const contract = value['contract'] === undefined
        ? undefined
        : parseEffectiveSessionContract(value['contract']);
      if (adapterStatus !== undefined && contract?.framework == null) {
        throw new UiProtocolError('session: adapterStatus requires a framework contract');
      }
      const sessionId = requireString(value, 'sessionId', 'session');
      if (contract !== undefined && contract.sessionId !== sessionId) {
        throw new UiProtocolError('session: contract sessionId does not match the message');
      }
      return {
        v: 1,
        type: 'session',
        sessionId,
        ...(value['testId'] === undefined
          ? {}
          : { testId: requireString(value, 'testId', 'session') }),
        terminalProfile: requireString(value, 'terminalProfile', 'session'),
        ...(contract === undefined ? {} : { contract }),
        ...(adapterStatus === undefined ? {} : { adapterStatus }),
        columns: requireNumber(value, 'columns', 'session'),
        rows: requireNumber(value, 'rows', 'session'),
      };
    }
    case 'run-start': {
      const mode = value['mode'];
      if (mode !== 'live' && mode !== 'post-mortem' && mode !== 'record') {
        throw new UiProtocolError('run-start: mode must be live, post-mortem or record');
      }
      return {
        v: 1,
        type: 'run-start',
        runId: requireBoundedString(value, 'runId', 'run-start'),
        mode,
        startedAt: requireNumber(value, 'startedAt', 'run-start'),
      };
    }
    case 'test-start': {
      const sessionId = value['sessionId'];
      if (sessionId !== undefined && typeof sessionId !== 'string') {
        throw new UiProtocolError('test-start: sessionId must be a string');
      }
      return {
        v: 1,
        type: 'test-start',
        id: requireString(value, 'id', 'test-start'),
        ...(value['runnerTaskId'] === undefined
          ? {}
          : { runnerTaskId: requireBoundedString(value, 'runnerTaskId', 'test-start') }),
        ...(value['executionId'] === undefined
          ? {}
          : { executionId: requireBoundedString(value, 'executionId', 'test-start') }),
        ...(value['attempt'] === undefined
          ? {}
          : { attempt: requirePositiveInteger(value, 'attempt', 'test-start') }),
        title: requireString(value, 'title', 'test-start'),
        file: requireString(value, 'file', 'test-start'),
        startedAt: requireNumber(value, 'startedAt', 'test-start'),
        ...(sessionId === undefined ? {} : { sessionId }),
      };
    }
    case 'step': {
      const phase = value['phase'];
      if (phase !== 'start' && phase !== 'end') {
        throw new UiProtocolError('step: phase must be start or end');
      }
      const status = value['status'];
      if (status !== undefined && status !== 'passed' && status !== 'failed') {
        throw new UiProtocolError('step: status must be passed or failed');
      }
      const stepId = value['stepId'];
      if (stepId !== undefined && typeof stepId !== 'string') {
        throw new UiProtocolError('step: stepId must be a string');
      }
      const t = value['t'];
      if (t !== undefined && typeof t !== 'number') throw new UiProtocolError('step: t must be a number');
      const error = value['error'];
      if (error !== undefined && typeof error !== 'string') throw new UiProtocolError('step: error must be a string');
      const gherkin = parseGherkinStep(value['gherkin']);
      return {
        v: 1,
        type: 'step',
        testId: requireString(value, 'testId', 'step'),
        title: requireString(value, 'title', 'step'),
        phase,
        ...(stepId === undefined ? {} : { stepId }),
        ...(t === undefined ? {} : { t }),
        ...(status === undefined ? {} : { status }),
        ...(error === undefined ? {} : { error }),
        ...(gherkin === undefined ? {} : { gherkin }),
      };
    }
    case 'output':
      return {
        v: 1,
        type: 'output',
        sessionId: requireString(value, 'sessionId', 'output'),
        dataB64: requireBase64(value, 'dataB64', 'output'),
        t: requireNumber(value, 't', 'output'),
      };
    case 'semantic': {
      const snapshot = value['snapshot'];
      if (typeof snapshot !== 'object' || snapshot === null) {
        throw new UiProtocolError('semantic: snapshot must be an object');
      }
      return {
        v: 1,
        type: 'semantic',
        sessionId: requireString(value, 'sessionId', 'semantic'),
        revision: requireNumber(value, 'revision', 'semantic'),
        snapshot: snapshot as SemanticSnapshot,
      };
    }
    case 'test-end': {
      const status = value['status'];
      if (status !== 'passed' && status !== 'failed' && status !== 'skipped') {
        throw new UiProtocolError('test-end: status must be passed, failed or skipped');
      }
      const traceRef = value['traceRef'];
      if (traceRef !== undefined && typeof traceRef !== 'string') {
        throw new UiProtocolError('test-end: traceRef must be a string');
      }
      const error = value['error'];
      if (error !== undefined && typeof error !== 'string') {
        throw new UiProtocolError('test-end: error must be a string');
      }
      // Checked in the order the contract lists them, so a producer fixing one
      // field at a time is told about them in that order.
      const durationMs = requireNumber(value, 'durationMs', 'test-end');
      if (typeof value['flaky'] !== 'boolean') {
        throw new UiProtocolError('test-end: flaky must be a boolean');
      }
      const lostLogRecords = requireNumber(value, 'lostLogRecords', 'test-end');
      const attempt = value['attempt'];
      if (attempt !== undefined && (!Number.isInteger(attempt) || (attempt as number) < 1)) {
        throw new UiProtocolError('test-end: attempt must be a positive integer');
      }
      const priorFailures = parsePriorFailures(value['priorFailures']);
      if (priorFailures !== undefined && attempt === undefined) {
        throw new UiProtocolError('test-end: priorFailures requires attempt');
      }
      if (priorFailures?.some((failure) => failure.attempt >= (attempt as number))) {
        throw new UiProtocolError('test-end: prior failure must precede final attempt');
      }
      return {
        v: 1,
        type: 'test-end',
        id: requireString(value, 'id', 'test-end'),
        status,
        durationMs,
        flaky: value['flaky'],
        lostLogRecords,
        ...(traceRef === undefined ? {} : { traceRef }),
        ...(error === undefined ? {} : { error }),
        ...(attempt === undefined ? {} : { attempt: attempt as number }),
        ...(priorFailures === undefined ? {} : { priorFailures }),
      };
    }
    case 'action-start': {
      const optionalText = (key: string): Record<string, string> => {
        const found = value[key];
        if (found === undefined) return {};
        if (typeof found !== 'string') throw new UiProtocolError(`action-start: ${key} must be a string`);
        return { [key]: found };
      };
      return {
        v: 1,
        type: 'action-start',
        actionId: requireString(value, 'actionId', 'action-start'),
        api: requireString(value, 'api', 'action-start'),
        t: requireNumber(value, 't', 'action-start'),
        ...optionalText('testId'),
        ...optionalText('sessionId'),
        ...optionalText('selector'),
        ...optionalText('stepId'),
      };
    }
    case 'action': {
      const kind = value['kind'];
      if (kind !== 'action' && kind !== 'assert') {
        throw new UiProtocolError('action: kind must be action or assert');
      }
      if (typeof value['ok'] !== 'boolean') throw new UiProtocolError('action: ok must be a boolean');
      const optionalText = (key: string): Record<string, string> => {
        const found = value[key];
        if (found === undefined) return {};
        if (typeof found !== 'string') throw new UiProtocolError(`action: ${key} must be a string`);
        return { [key]: found };
      };
      const optionalRef = (): { ref?: LocatorRef } => {
        const found = value['ref'];
        if (found === undefined) return {};
        if (typeof found !== 'string' || !/^(?:semantic:[^@\s]+|screen:\d+,\d+,\d+,\d+)@\d+$/u.test(found)) {
          throw new UiProtocolError('action: ref must be an explicitly semantic or screen locator ref');
        }
        return { ref: found as LocatorRef };
      };
      const actionPlan = value['actionPlan'] === undefined ? undefined : parseUiActionPlan(value['actionPlan']);
      const actionability = value['actionability'] === undefined ? undefined : parseUiActionability(value['actionability']);
      if (actionability !== undefined && (kind !== 'action' || value['ok'] || actionability.actionable)) {
        throw new UiProtocolError('action: actionability is only valid for a rejected driver action');
      }
      return {
        v: 1,
        type: 'action',
        kind,
        api: requireString(value, 'api', 'action'),
        ...optionalText('actionId'),
        t: requireNumber(value, 't', 'action'),
        ok: value['ok'],
        ...optionalText('testId'),
        ...optionalText('sessionId'),
        ...optionalText('selector'),
        ...optionalRef(),
        ...optionalText('error'),
        ...(actionPlan === undefined ? {} : { actionPlan }),
        ...(actionability === undefined ? {} : { actionability }),
        ...optionalText('stepId'),
      };
    }
    case 'actionability-inspection': {
      const resultsValue = value['results'];
      const error = value['error'] === undefined ? undefined : requireBoundedString(value, 'error', 'actionability-inspection');
      if (resultsValue !== undefined && (!Array.isArray(resultsValue) || resultsValue.length !== 4)) {
        throw new UiProtocolError('actionability-inspection: results must contain four planner explanations');
      }
      if ((resultsValue === undefined) === (error === undefined)) {
        throw new UiProtocolError('actionability-inspection: exactly one of results or error is required');
      }
      const results = resultsValue?.map((entry) => parseUiActionability(entry));
      return {
        v: 1,
        type: 'actionability-inspection',
        requestId: requireBoundedString(value, 'requestId', 'actionability-inspection'),
        sessionId: requireBoundedString(value, 'sessionId', 'actionability-inspection'),
        nodeId: requireBoundedString(value, 'nodeId', 'actionability-inspection'),
        ...(results === undefined ? {} : { results }),
        ...(error === undefined ? {} : { error }),
      };
    }
    case 'control-result': {
      const control = value['control'];
      if (control !== 'pick' && control !== 'input') {
        throw new UiProtocolError('control-result: control must be pick or input');
      }
      if (typeof value['ok'] !== 'boolean') {
        throw new UiProtocolError('control-result: ok must be a boolean');
      }
      const error = value['error'] === undefined
        ? undefined
        : requireBoundedString(value, 'error', 'control-result');
      if (value['ok'] === (error !== undefined)) {
        throw new UiProtocolError('control-result: error is required exactly when ok is false');
      }
      return {
        v: 1,
        type: 'control-result',
        requestId: requireBoundedString(value, 'requestId', 'control-result'),
        control,
        ok: value['ok'],
        ...(error === undefined ? {} : { error }),
      };
    }
    case 'app-log': {
      const log = parseAppLog(value);
      if (log === null) throw new UiProtocolError('app-log: needs a finite t and a message');
      return { v: 1, type: 'app-log', sessionId: requireString(value, 'sessionId', 'app-log'), ...log };
    }
    case 'run-end': {
      const summary = value['summary'];
      if (typeof summary !== 'object' || summary === null) {
        throw new UiProtocolError('run-end: summary must be an object');
      }
      const record = summary as Record<string, unknown>;
      if (!['passed', 'passed-with-skips', 'failed', 'flaky', 'skipped', 'cancelled', 'crashed', 'infrastructure-failed', 'incomplete'].includes(String(record['verdict']))) {
        throw new UiProtocolError('run-end: summary.verdict must be a terminal run verdict');
      }
      for (const key of ['total', 'passed', 'failed', 'skipped', 'flaky', 'durationMs']) {
        const count = record[key];
        if (typeof count !== 'number' || !Number.isFinite(count)) {
          throw new UiProtocolError(`run-end: summary.${key} must be a finite number`);
        }
      }
      return { v: 1, type: 'run-end', summary: summary as UiRunSummary };
    }
    case 'run-cancelled':
      return {
        v: 1,
        type: 'run-cancelled',
        stoppedAt: requireNumber(value, 'stoppedAt', 'run-cancelled'),
      };
    case 'run-cancel-failed':
      return {
        v: 1,
        type: 'run-cancel-failed',
        error: requireBoundedString(value, 'error', 'run-cancel-failed'),
      };
    case 'run-infrastructure-failed':
      return {
        v: 1,
        type: 'run-infrastructure-failed',
        runId: requireBoundedString(value, 'runId', 'run-infrastructure-failed'),
        error: requireBoundedString(value, 'error', 'run-infrastructure-failed'),
      };
    case 'diagnostic-gap': {
      const source = value['source'];
      if (source !== 'ui-hub' && source !== 'live-session-producer') {
        throw new UiProtocolError('diagnostic-gap: source is invalid');
      }
      return {
        v: 1,
        type: 'diagnostic-gap',
        source,
        droppedMessages: requireNonNegativeInteger(value, 'droppedMessages', 'diagnostic-gap'),
        droppedBytes: requireNonNegativeInteger(value, 'droppedBytes', 'diagnostic-gap'),
      };
    }
    default:
      throw new UiProtocolError(`unknown server message type: ${String(value.type)}`);
  }
}

function parseUiActionability(value: unknown): UiActionability {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new UiProtocolError('action.actionability must be an object');
  const record = value as Record<string, unknown>;
  if (typeof record['actionable'] !== 'boolean') throw new UiProtocolError('action.actionability actionable must be boolean');
  const sequence = requireNumber(record, 'sequence', 'action.actionability');
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new UiProtocolError('action.actionability sequence must be a non-negative integer');
  const requirementsValue = record['requirements'];
  if (!Array.isArray(requirementsValue) || requirementsValue.length > 128) throw new UiProtocolError('action.actionability requirements must be a bounded array');
  const requirements = requirementsValue.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new UiProtocolError(`action.actionability.requirements[${index}] must be an object`);
    const requirement = value as Record<string, unknown>;
    const verdict = requirement['verdict'];
    const observation = requirement['observation'];
    if (verdict !== 'satisfied' && verdict !== 'unsatisfied' && verdict !== 'inconclusive') throw new UiProtocolError(`action.actionability.requirements[${index}] has invalid verdict`);
    if (observation !== 'known' && observation !== 'absent' && observation !== 'unknown' && observation !== 'unsupported') throw new UiProtocolError(`action.actionability.requirements[${index}] has invalid observation`);
    const target = requirement['target'];
    if (target !== undefined && typeof target !== 'string') throw new UiProtocolError(`action.actionability.requirements[${index}] has invalid target`);
    const requirementEvidence = requirement['evidence'] === undefined ? undefined : parseEvidence(requirement['evidence'], `action.actionability.requirements[${index}]`);
    validateUiRequirementEvidence(observation, requirementEvidence, `action.actionability.requirements[${index}]`);
    const requirementKind = requireBoundedString(requirement, 'kind', `action.actionability.requirements[${index}]`);
    if (!UI_ACTION_REQUIREMENT_KINDS.has(requirementKind)) throw new UiProtocolError(`action.actionability.requirements[${index}] has invalid kind`);
    return {
      kind: requirementKind,
      ...(target === undefined ? {} : { target }), verdict, observation,
      ...(requirementEvidence === undefined ? {} : { evidence: requirementEvidence }),
    } as UiActionRequirement;
  });
  const rawReason = record['reason'];
  let reason: UiActionability['reason'];
  if (rawReason !== undefined) {
    if (typeof rawReason !== 'object' || rawReason === null || Array.isArray(rawReason)) throw new UiProtocolError('action.actionability reason must be an object');
    const item = rawReason as Record<string, unknown>;
    const targetRef = item['targetRef'];
    if (targetRef !== undefined && (typeof targetRef !== 'string' || !/^(?:semantic:[^@\s]+|screen:\d+,\d+,\d+,\d+)@\d+$/u.test(targetRef))) {
      throw new UiProtocolError('action.actionability reason targetRef must be an explicitly semantic or screen locator ref');
    }
    reason = { code: requireBoundedString(item, 'code', 'action.actionability.reason'), message: requireBoundedString(item, 'message', 'action.actionability.reason'), ...(targetRef === undefined ? {} : { targetRef: targetRef as LocatorRef }) };
  }
  if (record['actionable'] === false && reason === undefined) throw new UiProtocolError('action.actionability rejected result requires reason');
  const strategy = record['strategy'];
  if (strategy !== undefined && typeof strategy !== 'string') throw new UiProtocolError('action.actionability strategy must be a string');
  return {
    actionable: record['actionable'], kind: requireBoundedString(record, 'kind', 'action.actionability'),
    contractId: requireBoundedString(record, 'contractId', 'action.actionability'), sequence, requirements,
    ...(strategy === undefined ? {} : { strategy }), ...(reason === undefined ? {} : { reason }),
  };
}

function parseGherkinStep(value: unknown): UiGherkinStep | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) throw new UiProtocolError('step: gherkin must be an object');
  const record = value as Record<string, unknown>;
  const sourceValue = record['source'];
  if (typeof sourceValue !== 'object' || sourceValue === null) {
    throw new UiProtocolError('step: gherkin.source must be an object');
  }
  const source = sourceValue as Record<string, unknown>;
  const background = record['background'];
  if (background !== undefined && typeof background !== 'boolean') {
    throw new UiProtocolError('step: gherkin.background must be a boolean');
  }
  return {
    keyword: requireString(record, 'keyword', 'step.gherkin'),
    text: requireString(record, 'text', 'step.gherkin'),
    source: {
      file: requireString(source, 'file', 'step.gherkin.source'),
      line: requireNumber(source, 'line', 'step.gherkin.source'),
      column: requireNumber(source, 'column', 'step.gherkin.source'),
    },
    ...(background === undefined ? {} : { background }),
  };
}

function parsePriorFailures(value: unknown): readonly UiPriorFailure[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    throw new UiProtocolError('test-end: priorFailures must be a bounded array');
  }
  let previous = 0;
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) throw new UiProtocolError('test-end: invalid prior failure');
    const record = entry as Record<string, unknown>;
    const attempt = record['attempt'];
    const errors = record['errors'];
    if (!Number.isInteger(attempt) || (attempt as number) <= previous) {
      throw new UiProtocolError('test-end: prior failure attempts must be positive and ordered');
    }
    if (!Array.isArray(errors) || errors.length === 0 || errors.length > 100) {
      throw new UiProtocolError('test-end: prior failure errors must be a bounded non-empty array');
    }
    const parsed = errors.map((error) => {
      if (typeof error !== 'string' || error === '') throw new UiProtocolError('test-end: prior failure errors must be strings');
      return error.slice(0, MAX_UI_WIRE_STRING_LENGTH);
    });
    previous = attempt as number;
    return { attempt: attempt as number, errors: parsed };
  });
}

/** Maximum UTF-16 length of the short labels carried by UI wire events. */
export const MAX_UI_WIRE_STRING_LENGTH = 256;

const UI_ACTION_REQUIREMENT_KINDS: ReadonlySet<string> = new Set(CONDITION_KINDS);

function parseDiscoveredProvider(
  value: unknown,
  context: string,
): DiscoveredTest['provider'] {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UiProtocolError(`${context}: provider must be an object`);
  }
  const provider = value as Record<string, unknown>;
  const id = requireBoundedString(provider, 'id', `${context}.provider`);
  const version = requireNumber(provider, 'version', `${context}.provider`);
  if (!Number.isInteger(version) || version < 1) {
    throw new UiProtocolError(`${context}.provider: version must be a positive integer`);
  }
  return { id, version };
}

function parseDiscoveredKind(value: unknown, context: string): DiscoveredTestKind | undefined {
  if (value === undefined) return undefined;
  if (value !== 'test' && value !== 'gherkin-scenario' && value !== 'gherkin-outline-example') {
    throw new UiProtocolError(`${context}: kind is invalid`);
  }
  return value;
}

function parseDiscoveredAncestors(
  value: unknown,
  context: string,
): readonly DiscoveredTestAncestor[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 16) {
    throw new UiProtocolError(`${context}: ancestors must be a bounded array`);
  }
  return value.map((item, index) => {
    const itemContext = `${context}.ancestors[${index}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new UiProtocolError(`${itemContext} must be an object`);
    }
    const ancestor = item as Record<string, unknown>;
    const kind = ancestor['kind'];
    if (kind !== 'feature' && kind !== 'rule') {
      throw new UiProtocolError(`${itemContext}: kind is invalid`);
    }
    return { kind, title: requireBoundedString(ancestor, 'title', itemContext) };
  });
}

function parseDiscoveredTags(value: unknown, context: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 256) {
    throw new UiProtocolError(`${context}: tags must be a bounded array`);
  }
  return value.map((tag, index) => {
    if (typeof tag !== 'string' || tag.length === 0 || tag.length > MAX_UI_WIRE_STRING_LENGTH) {
      throw new UiProtocolError(`${context}.tags[${index}] must be a non-empty bounded string`);
    }
    return tag;
  });
}

function parseDiscoveredSource(value: unknown, context: string): DiscoveredTestSource | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UiProtocolError(`${context}: source must be an object`);
  }
  const source = value as Record<string, unknown>;
  const line = requireNumber(source, 'line', `${context}.source`);
  const column = requireNumber(source, 'column', `${context}.source`);
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) {
    throw new UiProtocolError(`${context}.source: line and column must be positive integers`);
  }
  const file = requireString(source, 'file', `${context}.source`);
  if (file === '') throw new UiProtocolError(`${context}.source: file must be non-empty`);
  return { file, line, column };
}

const EVIDENCE_SOURCES = new Set(['framework', 'application', 'terminal', 'recognizer', 'driver']);
const EVIDENCE_METHODS = new Set(['native', 'instrumented', 'declared', 'correlated', 'measured', 'derived', 'heuristic']);
const EVIDENCE_STRENGTHS = new Set(['authoritative', 'diagnostic']);
const UNSUPPORTED_REASONS = new Set(['not-negotiated', 'framework-unobservable', 'terminal-unobservable', 'provider-required']);

function parseUiActionPlan(value: unknown): UiActionPlan {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UiProtocolError('action.actionPlan must be an object');
  }
  const record = value as Record<string, unknown>;
  const operationsValue = record['operations'];
  if (!Array.isArray(operationsValue) || operationsValue.length > 10_000) {
    throw new UiProtocolError('action.actionPlan operations must be a bounded array');
  }
  const operations = operationsValue.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new UiProtocolError(`action.actionPlan.operations[${index}] must be an object`);
    }
    const operation = value as Record<string, unknown>;
    const rawDevice = operation['device'];
    if (rawDevice !== 'keyboard' && rawDevice !== 'mouse') {
      throw new UiProtocolError(`action.actionPlan.operations[${index}] has invalid device`);
    }
    const device: 'keyboard' | 'mouse' = rawDevice;
    const rawModifiers = operation['modifiers'];
    if (rawModifiers !== undefined && (device !== 'mouse' || !Array.isArray(rawModifiers) ||
        rawModifiers.some((modifier) => modifier !== 'shift' && modifier !== 'alt' && modifier !== 'control'))) {
      throw new UiProtocolError(`action.actionPlan.operations[${index}] has invalid modifiers`);
    }
    const modifiers = rawModifiers as ('shift' | 'alt' | 'control')[] | undefined;
    return {
      device,
      kind: requireBoundedString(operation, 'kind', `action.actionPlan.operations[${index}]`),
      ...(modifiers === undefined ? {} : { modifiers }),
    };
  });
  const beforeSequence = requireNumber(record, 'beforeSequence', 'action.actionPlan');
  const afterSequence = requireNumber(record, 'afterSequence', 'action.actionPlan');
  if (!Number.isInteger(beforeSequence) || !Number.isInteger(afterSequence)) {
    throw new UiProtocolError('action.actionPlan sequences must be integers');
  }
  const requirementsValue = record['requirements'];
  if (!Array.isArray(requirementsValue) || requirementsValue.length > 128) {
    throw new UiProtocolError('action.actionPlan requirements must be a bounded array');
  }
  const requirements = requirementsValue.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new UiProtocolError(`action.actionPlan.requirements[${index}] must be an object`);
    }
    const requirement = value as Record<string, unknown>;
    const verdict = requirement['verdict'];
    const observation = requirement['observation'];
    if (verdict !== 'satisfied' && verdict !== 'unsatisfied' && verdict !== 'inconclusive') {
      throw new UiProtocolError(`action.actionPlan.requirements[${index}] has invalid verdict`);
    }
    if (observation !== 'known' && observation !== 'absent' && observation !== 'unknown' && observation !== 'unsupported') {
      throw new UiProtocolError(`action.actionPlan.requirements[${index}] has invalid observation`);
    }
    const checkedVerdict: 'satisfied' | 'unsatisfied' | 'inconclusive' = verdict;
    const checkedObservation: 'known' | 'absent' | 'unknown' | 'unsupported' = observation;
    const target = requirement['target'];
    if (target !== undefined && typeof target !== 'string') {
      throw new UiProtocolError(`action.actionPlan.requirements[${index}] has invalid target`);
    }
    const requirementEvidence = requirement['evidence'] === undefined
      ? undefined
      : parseEvidence(requirement['evidence'], `action.actionPlan.requirements[${index}]`);
    validateUiRequirementEvidence(checkedObservation, requirementEvidence, `action.actionPlan.requirements[${index}]`);
    const requirementKind = requireBoundedString(requirement, 'kind', `action.actionPlan.requirements[${index}]`);
    if (!UI_ACTION_REQUIREMENT_KINDS.has(requirementKind)) throw new UiProtocolError(`action.actionPlan.requirements[${index}] has invalid kind`);
    return {
      kind: requirementKind,
      ...(target === undefined ? {} : { target }), verdict: checkedVerdict, observation: checkedObservation,
      ...(requirementEvidence === undefined ? {} : { evidence: requirementEvidence }),
    };
  });
  const physicalEvidence = record['physicalEvidence'] === undefined
    ? undefined
    : parseEvidence(record['physicalEvidence'], 'action.actionPlan.physicalEvidence');
  if (physicalEvidence !== undefined && physicalEvidence.strength !== 'authoritative') {
    throw new UiProtocolError('action.actionPlan.physicalEvidence must be authoritative');
  }
  return {
    actionId: requireBoundedString(record, 'actionId', 'action.actionPlan'),
    kind: requireBoundedString(record, 'kind', 'action.actionPlan'),
    strategy: requireBoundedString(record, 'strategy', 'action.actionPlan'),
    contractId: requireBoundedString(record, 'contractId', 'action.actionPlan'),
    beforeSequence,
    afterSequence,
    operations,
    requirements,
    ...(physicalEvidence === undefined ? {} : { physicalEvidence }),
  };
}

function parseEvidence(value: unknown, context: string): EvidenceProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UiProtocolError(`${context}: evidence must be an object`);
  }
  const record = value as Record<string, unknown>;
  const source = requireBoundedString(record, 'source', context);
  const method = requireBoundedString(record, 'method', context);
  const strength = requireBoundedString(record, 'strength', context);
  if (!EVIDENCE_SOURCES.has(source) || !EVIDENCE_METHODS.has(method) || !EVIDENCE_STRENGTHS.has(strength)) {
    throw new UiProtocolError(`${context}: invalid evidence provenance`);
  }
  return {
    source: source as EvidenceProvenance['source'],
    method: method as EvidenceProvenance['method'],
    strength: strength as EvidenceProvenance['strength'],
    providerId: requireBoundedString(record, 'providerId', context),
  };
}

function validateUiRequirementEvidence(
  observation: UiActionRequirement['observation'],
  evidence: EvidenceProvenance | undefined,
  context: string,
): void {
  if ((observation === 'known' || observation === 'absent') && evidence === undefined) {
    throw new UiProtocolError(`${context}: settled observation requires evidence`);
  }
  if (observation === 'absent' && evidence?.strength !== 'authoritative') {
    throw new UiProtocolError(`${context}: absent observation requires authoritative evidence`);
  }
  if ((observation === 'unknown' || observation === 'unsupported') && evidence !== undefined) {
    throw new UiProtocolError(`${context}: unsettled/unsupported observation must not claim evidence`);
  }
}

function parseEffectiveSessionContract(value: unknown): EffectiveSessionContract {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UiProtocolError('session.contract must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record['protocol'] !== 'termwright/2') throw new UiProtocolError('session.contract protocol must be termwright/2');
  const epoch = requireNumber(record, 'epoch', 'session.contract');
  if (!Number.isInteger(epoch) || epoch < 0) throw new UiProtocolError('session.contract epoch must be a non-negative integer');

  const frameworkValue = record['framework'];
  let framework: EffectiveSessionContract['framework'] = null;
  if (frameworkValue !== null) {
    if (typeof frameworkValue !== 'object' || frameworkValue === null || Array.isArray(frameworkValue)) {
      throw new UiProtocolError('session.contract framework must be an object or null');
    }
    const candidate = frameworkValue as Record<string, unknown>;
    framework = {
      name: requireBoundedString(candidate, 'name', 'session.contract.framework'),
      version: requireBoundedString(candidate, 'version', 'session.contract.framework'),
      adapterVersion: requireBoundedString(candidate, 'adapterVersion', 'session.contract.framework'),
      certificationId: requireBoundedString(candidate, 'certificationId', 'session.contract.framework'),
    };
  }

  const providersValue = record['providers'];
  if (!Array.isArray(providersValue) || providersValue.length > 32) {
    throw new UiProtocolError('session.contract providers must be a bounded array');
  }
  const providers: EffectiveSessionContract['providers'][number][] = providersValue.map((providerValue, index) => {
    if (typeof providerValue !== 'object' || providerValue === null || Array.isArray(providerValue)) {
      throw new UiProtocolError(`session.contract.providers[${index}] must be an object`);
    }
    const provider = providerValue as Record<string, unknown>;
    const kind = provider['kind'];
    const base = {
      id: requireBoundedString(provider, 'id', `session.contract.providers[${index}]`),
      version: requireBoundedString(provider, 'version', `session.contract.providers[${index}]`),
    };
    if (kind === 'framework' || kind === 'terminal') return { ...base, kind };
    if (kind !== 'application') throw new UiProtocolError(`session.contract.providers[${index}] has invalid kind`);
    const method = provider['method'];
    if (method !== 'native' && method !== 'declared') throw new UiProtocolError(`session.contract.providers[${index}] has invalid method`);
    const capabilities = provider['capabilities'];
    if (!Array.isArray(capabilities) || capabilities.length > EVIDENCE_PROVIDER_CAPABILITIES.length ||
        new Set(capabilities).size !== capabilities.length ||
        !capabilities.every((item) => EVIDENCE_PROVIDER_CAPABILITIES.includes(item as (typeof EVIDENCE_PROVIDER_CAPABILITIES)[number])) ||
        (capabilities.includes('hit-test') && !capabilities.includes('pointer-regions'))) {
      throw new UiProtocolError(`session.contract.providers[${index}] has invalid capabilities`);
    }
    return { ...base, kind, method, capabilities };
  });
  const providerIds = new Set(providers.map((provider) => provider.id));
  if (providerIds.size !== providers.length) throw new UiProtocolError('session.contract providers contain duplicate ids');

  const capabilitiesValue = record['capabilities'];
  if (typeof capabilitiesValue !== 'object' || capabilitiesValue === null || Array.isArray(capabilitiesValue)) {
    throw new UiProtocolError('session.contract capabilities must be an object');
  }
  const capabilityRecord = capabilitiesValue as Record<string, unknown>;
  if (Object.keys(capabilityRecord).length !== SESSION_CAPABILITIES.length ||
      Object.keys(capabilityRecord).some((id) => !SESSION_CAPABILITIES.includes(id as (typeof SESSION_CAPABILITIES)[number]))) {
    throw new UiProtocolError('session.contract capabilities must contain exactly the closed capability set');
  }
  const capabilities = Object.fromEntries(SESSION_CAPABILITIES.map((id) => {
    const raw = capabilityRecord[id];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new UiProtocolError(`session.contract capability ${id} must be an object`);
    }
    const availability = raw as Record<string, unknown>;
    if (availability['status'] === 'supported') {
      return [id, { status: 'supported', evidence: parseEvidence(availability['evidence'], `session.contract.capabilities.${id}`) }];
    }
    if (availability['status'] !== 'unsupported' || !UNSUPPORTED_REASONS.has(availability['reason'] as string)) {
      throw new UiProtocolError(`session.contract capability ${id} has invalid availability`);
    }
    return [id, { status: 'unsupported', reason: availability['reason'] }];
  })) as unknown as EffectiveSessionContract['capabilities'];
  for (const availability of Object.values(capabilities)) {
    if (availability.status !== 'supported') continue;
    const expectedKind = availability.evidence.source === 'framework' || availability.evidence.source === 'terminal' || availability.evidence.source === 'application'
      ? availability.evidence.source
      : null;
    if (expectedKind !== null && !providers.some((provider) => provider.id === availability.evidence.providerId && provider.kind === expectedKind)) {
      throw new UiProtocolError('session.contract capability evidence names an unknown provider');
    }
  }

  const terminalValue = record['terminal'];
  if (typeof terminalValue !== 'object' || terminalValue === null || Array.isArray(terminalValue)) {
    throw new UiProtocolError('session.contract terminal must be an object');
  }
  const terminal = terminalValue as Record<string, unknown>;
  if (typeof terminal['mouseModesObservable'] !== 'boolean') {
    throw new UiProtocolError('session.contract terminal.mouseModesObservable must be boolean');
  }
  return Object.freeze({
    contractId: requireBoundedString(record, 'contractId', 'session.contract'),
    sessionId: requireBoundedString(record, 'sessionId', 'session.contract'),
    epoch,
    protocol: 'termwright/2',
    framework,
    providers: Object.freeze(providers),
    capabilities: Object.freeze(capabilities),
    terminal: Object.freeze({
      profile: requireBoundedString(terminal, 'profile', 'session.contract.terminal'),
      platform: requireBoundedString(terminal, 'platform', 'session.contract.terminal'),
      mouseModesObservable: terminal['mouseModesObservable'],
    }),
  });
}

function parseEnvelope(
  raw: string | Uint8Array,
  allowed: ReadonlySet<string>,
): Record<string, unknown> & { type: string } {
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UiProtocolError('message is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UiProtocolError('message is not an object');
  }
  const value = parsed as Record<string, unknown>;
  if (value['v'] !== UI_PROTOCOL_VERSION) {
    throw new UiProtocolError(`unsupported protocol version: ${String(value['v'])}`);
  }
  const type = value['type'];
  if (typeof type !== 'string' || !allowed.has(type)) {
    throw new UiProtocolError(`unknown message type: ${String(type)}`);
  }
  return { ...value, type };
}

function requireString(value: Record<string, unknown>, key: string, type: string): string {
  const found = value[key];
  if (typeof found !== 'string') throw new UiProtocolError(`${type}: ${key} must be a string`);
  return found;
}

function requireBoundedString(value: Record<string, unknown>, key: string, type: string): string {
  const found = requireString(value, key, type);
  if (found.length === 0 || found.length > MAX_UI_WIRE_STRING_LENGTH) {
    throw new UiProtocolError(`${type}: ${key} must be a non-empty bounded string`);
  }
  return found;
}

function requireNumber(value: Record<string, unknown>, key: string, type: string): number {
  const found = value[key];
  if (typeof found !== 'number' || !Number.isFinite(found)) {
    throw new UiProtocolError(`${type}: ${key} must be a finite number`);
  }
  return found;
}

function requirePositiveInteger(value: Record<string, unknown>, key: string, type: string): number {
  const found = requireNumber(value, key, type);
  if (!Number.isSafeInteger(found) || found < 1) {
    throw new UiProtocolError(`${type}: ${key} must be a positive integer`);
  }
  return found;
}

function requireNonNegativeInteger(value: Record<string, unknown>, key: string, type: string): number {
  const found = requireNumber(value, key, type);
  if (!Number.isSafeInteger(found) || found < 0) {
    throw new UiProtocolError(`${type}: ${key} must be a non-negative integer`);
  }
  return found;
}

function requireBase64(value: Record<string, unknown>, key: string, type: string): string {
  const found = requireString(value, key, type);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(found)) {
    throw new UiProtocolError(`${type}: ${key} must be base64`);
  }
  return found;
}
