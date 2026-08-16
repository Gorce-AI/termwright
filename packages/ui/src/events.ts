/**
 * The `§UI events` wire protocol from `/CONTRACTS.md`: the JSON messages the
 * runner server and the browser app exchange over one WebSocket.
 *
 * The protocol is deliberately tiny. Everything that is *state* rather than an
 * *event* — the session list, the opened trace, a point on the time-travel
 * timeline — is fetched over HTTP instead (see `server.ts`), so this file stays
 * a one-to-one transcription of the contract.
 *
 * Both directions are validated on arrival: a browser tab is untrusted input,
 * and so is a reporter running in somebody else's Vitest process.
 *
 * @packageDocumentation
 */

import type { SemanticSnapshot } from '@termwright/protocol';
import { parseAppLog, type AppLogView } from './app-log.js';

/** Protocol version carried by every message. */
export const UI_PROTOCOL_VERSION = 1;

/** Outcome of a test, as the timeline pane shows it. */
export type UiTestStatus = 'passed' | 'failed' | 'skipped';

/** Whether a `step` message opens or closes a step. */
export type UiStepPhase = 'start' | 'end';

/** Counters closing a run. */
export interface UiRunSummary {
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

/** server → client. */
export type ServerMessage =
  | {
      readonly v: 1;
      readonly type: 'tests-discovered';
      /**
       * Every test the project holds, before anything runs. Ids are
       * `<file>::<full name>`, so a runner can turn one back into a Vitest
       * invocation and the browser can reconcile a discovered row with the
       * running test that replaces it.
       */
      readonly tests: readonly { readonly id: string; readonly title: string; readonly file: string }[];
    }
  | {
      readonly v: 1;
      readonly type: 'session';
      readonly sessionId: string;
      /**
       * Terminal profile the session runs with. The browser has to measure
       * characters the way the session does, or say which widths it used —
       * a frame that lands a column apart with nothing to explain it is the
       * expensive kind of wrong.
       */
      readonly terminalProfile: string;
      readonly columns: number;
      readonly rows: number;
    }
  | { readonly v: 1; readonly type: 'run-start'; readonly mode: UiServerMode; readonly startedAt: number }
  | {
      readonly v: 1;
      readonly type: 'test-start';
      readonly id: string;
      readonly title: string;
      readonly file: string;
      /**
       * Unix epoch milliseconds when the test started. A tab that connects
       * mid-run replays the backlog and needs this to show a truthful elapsed
       * time; without it, every running test would look like it just began.
       */
      readonly startedAt: number;
      /**
       * Session this test drives. The one optional field here: a Vitest
       * reporter genuinely cannot know a worker's sessions, and inventing one
       * would be worse than admitting it.
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
    }
  | { readonly v: 1; readonly type: 'run-end'; readonly summary: UiRunSummary }
  | ({
      readonly v: 1;
      readonly type: 'app-log';
      readonly sessionId: string;
    } & AppLogView)
  | {
      readonly v: 1;
      readonly type: 'action';
      /** `action` for a driver call, `assert` for an expectation. */
      readonly kind: 'action' | 'assert';
      /** Driver API name, e.g. `locator.click`, or the matcher's name. */
      readonly api: string;
      /** Milliseconds on the session clock. */
      readonly t: number;
      readonly ok: boolean;
      readonly testId?: string;
      readonly sessionId?: string;
      readonly selector?: string;
      /** Resolved target ref, `n8@42`. */
      readonly ref?: string;
      readonly error?: string;
      readonly stepId?: string;
    };

/** client → server. */
export type ClientMessage =
  | { readonly v: 1; readonly type: 'rerun'; readonly testIds?: readonly string[] }
  | { readonly v: 1; readonly type: 'stop' }
  | { readonly v: 1; readonly type: 'pick'; readonly sessionId: string; readonly enabled?: boolean }
  | { readonly v: 1; readonly type: 'input'; readonly sessionId: string; readonly dataB64: string };

/** Any message on the socket, in either direction. */
export type UiMessage = ServerMessage | ClientMessage;

const SERVER_TYPES = new Set([
  'tests-discovered',
  'session',
  'run-start',
  'test-start',
  'step',
  'output',
  'semantic',
  'test-end',
  'run-end',
  'app-log',
  'action',
]);
const CLIENT_TYPES = new Set(['rerun', 'stop', 'pick', 'input']);

/** Thrown by {@link parseClientMessage} and {@link parseServerMessage}. */
export class UiProtocolError extends Error {
  override readonly name = 'UiProtocolError';
}

/**
 * Encodes a message for the socket.
 *
 * @example
 * ```ts
 * socket.send(encodeMessage({ v: 1, type: 'stop' }));
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
    case 'rerun': {
      const ids = value['testIds'];
      if (ids === undefined) return { v: 1, type: 'rerun' };
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        throw new UiProtocolError('rerun: testIds must be an array of strings');
      }
      return { v: 1, type: 'rerun', testIds: ids as readonly string[] };
    }
    case 'stop':
      return { v: 1, type: 'stop' };
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
      };
    }
    case 'input':
      return {
        v: 1,
        type: 'input',
        sessionId: requireString(value, 'sessionId', 'input'),
        dataB64: requireBase64(value, 'dataB64', 'input'),
      };
    default:
      throw new UiProtocolError(`unknown client message type: ${String(value.type)}`);
  }
}

/**
 * Parses and validates a server→client message. Used by the browser app and by
 * the server itself when a reporter feeds it messages over a socket.
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
          return {
            id: requireString(test, 'id', `tests-discovered.tests[${index}]`),
            title: requireString(test, 'title', `tests-discovered.tests[${index}]`),
            file: requireString(test, 'file', `tests-discovered.tests[${index}]`),
          };
        }),
      };
    }
    case 'session':
      return {
        v: 1,
        type: 'session',
        sessionId: requireString(value, 'sessionId', 'session'),
        terminalProfile: requireString(value, 'terminalProfile', 'session'),
        columns: requireNumber(value, 'columns', 'session'),
        rows: requireNumber(value, 'rows', 'session'),
      };
    case 'run-start': {
      const mode = value['mode'];
      if (mode !== 'live' && mode !== 'post-mortem' && mode !== 'record') {
        throw new UiProtocolError('run-start: mode must be live, post-mortem or record');
      }
      return { v: 1, type: 'run-start', mode, startedAt: requireNumber(value, 'startedAt', 'run-start') };
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
      return {
        v: 1,
        type: 'step',
        testId: requireString(value, 'testId', 'step'),
        title: requireString(value, 'title', 'step'),
        phase,
        ...(stepId === undefined ? {} : { stepId }),
        ...(t === undefined ? {} : { t }),
        ...(status === undefined ? {} : { status }),
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
      return {
        v: 1,
        type: 'action',
        kind,
        api: requireString(value, 'api', 'action'),
        t: requireNumber(value, 't', 'action'),
        ok: value['ok'],
        ...optionalText('testId'),
        ...optionalText('sessionId'),
        ...optionalText('selector'),
        ...optionalText('ref'),
        ...optionalText('error'),
        ...optionalText('stepId'),
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
      for (const key of ['total', 'passed', 'failed', 'skipped', 'flaky', 'durationMs']) {
        const count = record[key];
        if (typeof count !== 'number' || !Number.isFinite(count)) {
          throw new UiProtocolError(`run-end: summary.${key} must be a finite number`);
        }
      }
      return { v: 1, type: 'run-end', summary: summary as UiRunSummary };
    }
    default:
      throw new UiProtocolError(`unknown server message type: ${String(value.type)}`);
  }
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

function requireNumber(value: Record<string, unknown>, key: string, type: string): number {
  const found = value[key];
  if (typeof found !== 'number' || !Number.isFinite(found)) {
    throw new UiProtocolError(`${type}: ${key} must be a finite number`);
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
