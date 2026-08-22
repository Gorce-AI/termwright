import { describe, expect, it } from 'vitest';
import type { EffectiveSessionContract } from '@termwright/protocol';
import { SESSION_CAPABILITIES } from '@termwright/protocol/contract';
import { CONDITION_KINDS } from '@termwright/protocol/action-model';
import {
  encodeMessage,
  fromBase64,
  parseClientMessage,
  parseServerMessage,
  toBase64,
  UiProtocolError,
  type ServerMessage,
} from './events.js';

describe('server messages', () => {
  it('rejects action refs without an explicit locator domain', () => {
    expect(() => parseServerMessage(JSON.stringify({
      v: 1, type: 'action', kind: 'action', api: 'click', t: 1, ok: true, ref: 'n1@7',
    }))).toThrow(/explicitly semantic or screen locator ref/u);
  });
  it('round-trips every message the contract lists', () => {
    const contract: EffectiveSessionContract = {
      contractId: 's1:0', sessionId: 's1', epoch: 0, protocol: 'termwright/2', framework: null,
      providers: [
        { id: 'terminal', kind: 'terminal', version: '1' },
        {
          id: 'app-strategies',
          kind: 'application',
          version: '1',
          method: 'native',
          capabilities: ['action-recipes'],
        },
      ],
      capabilities: Object.fromEntries(SESSION_CAPABILITIES.map((id) => [id, id === 'keyboard-input'
        ? { status: 'supported', evidence: { source: 'terminal', method: 'native', strength: 'authoritative', providerId: 'terminal' } }
        : { status: 'unsupported', reason: 'not-negotiated' }])) as EffectiveSessionContract['capabilities'],
      terminal: { profile: 'default', platform: 'darwin', mouseModesObservable: true },
    };
    const messages: ServerMessage[] = [
      {
        v: 1,
        type: 'tests-discovered',
        tests: [{
          id: '/repo/login.feature::login > succeeds',
          title: 'login > succeeds',
          file: '/repo/login.feature',
          provider: { id: '@termwright/test', version: 1 },
          kind: 'gherkin-scenario',
          ancestors: [{ kind: 'feature', title: 'login' }],
          tags: ['@smoke'],
          source: { file: '/repo/login.feature', line: 3, column: 3 },
        }],
      },
      {
        v: 1,
        type: 'session',
        sessionId: 's1',
        testId: 't1',
        terminalProfile: 'default',
        contract,
        columns: 80,
        rows: 24,
      },
      { v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 1_700_000_000_000 },
      {
        v: 1,
        type: 'test-start',
        id: 't1',
        title: 'login',
        file: '/repo/login.test.ts',
        startedAt: 1_700_000_000_000,
        sessionId: 's1',
      },
      { v: 1, type: 'step', testId: 't1', title: 'submit', phase: 'start', t: 120 },
      {
        v: 1,
        type: 'action-start',
        actionId: 'a1',
        api: 'click',
        t: 121,
        testId: 't1',
        sessionId: 's1',
        selector: 'getByRole("button")',
      },
      { v: 1, type: 'output', sessionId: 's1', dataB64: toBase64(new TextEncoder().encode('hi')), t: 5 },
      {
        v: 1,
        type: 'semantic',
        sessionId: 's1',
        revision: 7,
        snapshot: {
          v: 2,
          sessionId: 's1',
          revision: 7,
          columns: 80,
          rows: 24,
          rootIds: [],
          nodes: [],
          coordinateSpace: { status: 'unknown', reason: 'awaiting-revision-pair' },
          hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
        },
      },
      {
        v: 1,
        type: 'action',
        kind: 'action',
        actionId: 'a1',
        api: 'click',
        t: 122,
        ok: true,
        sessionId: 's1',
        ref: 'semantic:n1@7',
        actionPlan: {
          actionId: 'a1', kind: 'click', strategy: 'authoritative-pointer-region', contractId: 's1:0',
          beforeSequence: 7, afterSequence: 8,
          operations: [{ device: 'mouse', kind: 'down' }, { device: 'mouse', kind: 'up' }],
          requirements: [],
        },
      },
      {
        v: 1,
        type: 'test-end',
        id: 't1',
        status: 'failed',
        traceRef: 'out/login.twtrace',
        durationMs: 1_234,
        flaky: true,
        lostLogRecords: 0,
        attempt: 3,
        priorFailures: [
          { attempt: 1, errors: ['socket not ready'] },
          { attempt: 2, errors: ['prompt missing'] },
        ],
      },
      { v: 1, type: 'run-end', summary: { total: 1, passed: 0, failed: 1, skipped: 0, flaky: 1, durationMs: 900 } },
      { v: 1, type: 'run-cancelled', stoppedAt: 1_700_000_001_000 },
      { v: 1, type: 'run-cancel-failed', error: 'process did not exit' },
      { v: 1, type: 'diagnostic-gap', source: 'ui-hub', droppedMessages: 3, droppedBytes: 512 },
    ];
    for (const message of messages) {
      expect(parseServerMessage(encodeMessage(message))).toEqual(message);
    }
  });

  it('rejects an unknown type rather than ignoring it', () => {
    expect(() => parseServerMessage('{"v":1,"type":"reload"}')).toThrow(UiProtocolError);
  });

  it('rejects a future protocol version', () => {
    expect(() => parseServerMessage('{"v":2,"type":"run-end","summary":{}}')).toThrow(
      /unsupported protocol version/,
    );
  });

  it('rejects malformed payloads of a known type', () => {
    expect(() => parseServerMessage('{"v":1,"type":"output","sessionId":"s1","dataB64":"a","t":"x"}')).toThrow(
      /t must be a finite number/,
    );
    expect(() =>
      parseServerMessage('{"v":1,"type":"output","sessionId":"s1","dataB64":"not base64!","t":1}'),
    ).toThrow(/dataB64 must be base64/);
    expect(() => parseServerMessage('{"v":1,"type":"test-end","id":"t1","status":"exploded"}')).toThrow(
      /status must be/,
    );
    expect(() => parseServerMessage(
      '{"v":1,"type":"tests-discovered","tests":[{"id":"x","title":"x","file":"x.feature","source":{"file":"x.feature","line":0,"column":1}}]}',
    )).toThrow(/line and column must be positive integers/);
    expect(() => parseServerMessage(
      '{"v":1,"type":"diagnostic-gap","source":"ui-hub","droppedMessages":-1,"droppedBytes":0}',
    )).toThrow(/non-negative integer/);
  });

  it('rejects malformed test timings', () => {
    expect(() =>
      parseServerMessage(
        '{"v":1,"type":"test-end","id":"t1","status":"passed","durationMs":"fast","flaky":false}',
      ),
    ).toThrow(/durationMs must be a finite number/);
    expect(() =>
      parseServerMessage(
        '{"v":1,"type":"test-end","id":"t1","status":"passed","durationMs":1,"flaky":"yes"}',
      ),
    ).toThrow(/flaky must be a boolean/);
    expect(() =>
      parseServerMessage(
        '{"v":1,"type":"test-start","id":"t1","title":"x","file":"a.ts","startedAt":"now"}',
      ),
    ).toThrow(/startedAt must be a finite number/);
    expect(() => parseServerMessage(JSON.stringify({
      v: 1, type: 'test-end', id: 't1', status: 'passed', durationMs: 1, flaky: true,
      lostLogRecords: 0, attempt: 0,
    }))).toThrow(/attempt must be a positive integer/);
    expect(() => parseServerMessage(JSON.stringify({
      v: 1, type: 'test-end', id: 't1', status: 'passed', durationMs: 1, flaky: true,
      lostLogRecords: 0, attempt: 3,
      priorFailures: [{ attempt: 2, errors: ['second'] }, { attempt: 1, errors: ['first'] }],
    }))).toThrow(/positive and ordered/);
    expect(() => parseServerMessage(JSON.stringify({
      v: 1, type: 'test-end', id: 't1', status: 'passed', durationMs: 1, flaky: true,
      lostLogRecords: 0, priorFailures: [{ attempt: 1, errors: ['first'] }],
    }))).toThrow(/requires attempt/);
    expect(() => parseServerMessage(JSON.stringify({
      v: 1, type: 'test-end', id: 't1', status: 'passed', durationMs: 1, flaky: true,
      lostLogRecords: 0, attempt: 2, priorFailures: [{ attempt: 2, errors: ['not prior'] }],
    }))).toThrow(/precede final attempt/);
  });

  it('rejects a session message missing what the browser needs to build a terminal', () => {
    expect(() => parseServerMessage('{"v":1,"type":"session","sessionId":"s1"}')).toThrow(
      /terminalProfile must be a string/,
    );
    expect(() =>
      parseServerMessage('{"v":1,"type":"session","sessionId":"s1","terminalProfile":"default"}'),
    ).toThrow(/columns must be a finite number/);
    expect(() =>
      parseServerMessage(
        '{"v":1,"type":"session","sessionId":"s1","terminalProfile":"default","columns":80}',
      ),
    ).toThrow(/rows must be a finite number/);
  });

  it('rejects removed parallel adapter metadata instead of accepting a fallback', () => {
    expect(() =>
      parseServerMessage(JSON.stringify({
        v: 1,
        type: 'session',
        sessionId: 's1',
        terminalProfile: 'default',
        columns: 80,
        rows: 24,
        adapter: { name: 'probe-fixture', version: '0.1.0' },
      })),
    ).toThrow(/use the frozen contract/);
  });

  it('rejects removed probe and capability metadata', () => {
    expect(() =>
      parseServerMessage(JSON.stringify({
        v: 1,
        type: 'session',
        sessionId: 's1',
        terminalProfile: 'default',
        columns: 80,
        rows: 24,
        probe: {
          framework: 'fixture',
          probeVersion: '0.1.0',
          identityKind: 'stable',
          capabilities: [],
        },
      })),
    ).toThrow(/use the frozen contract/);
    expect(() => parseServerMessage(JSON.stringify({
      v: 1, type: 'session', sessionId: 's1', terminalProfile: 'default',
      columns: 80, rows: 24, capabilities: ['semantic-tree'],
    }))).toThrow(/use the frozen contract/);
  });

  it('rejects invalid adapter status and status without a framework contract', () => {
    const base = {
      v: 1,
      type: 'session',
      sessionId: 's1',
      terminalProfile: 'default',
      columns: 80,
      rows: 24,
    };
    expect(() =>
      parseServerMessage(JSON.stringify({ ...base, adapterStatus: 'healing' })),
    ).toThrow(/adapterStatus is invalid/);
    expect(() =>
      parseServerMessage(JSON.stringify({ ...base, adapterStatus: 'attached' })),
    ).toThrow(/requires a framework contract/);
  });

  it('rejects a message missing a required field instead of filling it in', () => {
    // One producer generation, no receiver-side fallbacks: a message that does
    // not carry what the contract promises is a bug to surface, not a shape to
    // repair.
    expect(() => parseServerMessage('{"v":1,"type":"test-start","id":"t1","title":"login"}')).toThrow(
      /file must be a string/,
    );
    expect(() =>
      parseServerMessage('{"v":1,"type":"test-start","id":"t1","title":"login","file":"a.ts"}'),
    ).toThrow(/startedAt must be a finite number/);
    expect(() => parseServerMessage('{"v":1,"type":"test-end","id":"t1","status":"passed"}')).toThrow(
      /durationMs must be a finite number/,
    );
    expect(() =>
      parseServerMessage('{"v":1,"type":"test-end","id":"t1","status":"passed","durationMs":5}'),
    ).toThrow(/flaky must be a boolean/);
    expect(() =>
      parseServerMessage(
        '{"v":1,"type":"test-end","id":"t1","status":"passed","durationMs":5,"flaky":false}',
      ),
    ).toThrow(/lostLogRecords must be a finite number/);
    expect(() =>
      parseServerMessage('{"v":1,"type":"run-end","summary":{"total":1,"passed":1,"failed":0,"skipped":0}}'),
    ).toThrow(/summary.flaky must be a finite number/);
    expect(() =>
      parseServerMessage(
        '{"v":1,"type":"run-end","summary":{"total":1,"passed":1,"failed":0,"skipped":0,"flaky":0}}',
      ),
    ).toThrow(/summary.durationMs must be a finite number/);
  });

  it('rejects non-JSON and non-objects', () => {
    expect(() => parseServerMessage('nope')).toThrow(/not valid JSON/);
    expect(() => parseServerMessage('[1,2]')).toThrow(/not an object/);
  });

  it('rejects action diagnostics with forged evidence provenance', () => {
    expect(() => parseServerMessage(JSON.stringify({
      v: 1, type: 'action', kind: 'action', api: 'click', t: 1, ok: true,
      actionPlan: {
        actionId: 'a1', kind: 'click', strategy: 'pointer', contractId: 's:0',
        beforeSequence: 1, afterSequence: 2, operations: [], requirements: [],
        physicalEvidence: { source: 'guess', method: 'heuristic', strength: 'authoritative', providerId: 'fake' },
      },
    }))).toThrow(/evidence/);
  });

  it('round-trips the exact failed actionability explanation', () => {
    const message = {
      v: 1, type: 'action', kind: 'action', api: 'click', t: 1, ok: false, error: 'not-actionable',
      actionability: {
        actionable: false, kind: 'click', contractId: 's:0', sequence: 9,
        requirements: [{
          kind: 'receives-pointer', target: 'save@9', verdict: 'unsatisfied', observation: 'known',
          evidence: { source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.router' },
        }],
        reason: { code: 'covered-by', message: 'Target is covered', targetRef: 'semantic:overlay@9' },
      },
    } as const;
    expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
  });

  it('rejects forged actionability attached to a successful action', () => {
    expect(() => parseServerMessage(JSON.stringify({
      v: 1, type: 'action', kind: 'action', api: 'click', t: 1, ok: true,
      actionability: {
        actionable: false, kind: 'click', contractId: 's:0', sequence: 9, requirements: [],
        reason: { code: 'covered-by', message: 'forged' },
      },
    }))).toThrow(/only valid for a rejected/);
  });

  it('accepts every canonical Condition from the browser-safe protocol export', () => {
    const action = parseServerMessage(JSON.stringify({
      v: 1, type: 'action', kind: 'action', api: 'drag', t: 1, ok: false,
      actionability: {
        actionable: false, kind: 'drag', contractId: 's:0', sequence: 9,
        requirements: CONDITION_KINDS.map((kind) => ({ kind, verdict: 'inconclusive', observation: 'unknown' })),
        reason: { code: 'input-mode-disabled', message: 'disabled' },
      },
    }));
    expect(action.type === 'action' ? action.actionability?.requirements.map(({ kind }) => kind) : []).toEqual(CONDITION_KINDS);
  });

  it('does not accept a client message in the server direction', () => {
    expect(() => parseServerMessage('{"v":1,"type":"stop"}')).toThrow(UiProtocolError);
  });
});

describe('client messages', () => {
  it('parses every client type', () => {
    expect(parseClientMessage('{"v":1,"type":"pick","sessionId":"s1"}')).toEqual({
      v: 1,
      type: 'pick',
      sessionId: 's1',
    });
    expect(parseClientMessage('{"v":1,"type":"input","sessionId":"s1","dataB64":"DQ=="}')).toEqual({
      v: 1,
      type: 'input',
      sessionId: 's1',
      dataB64: 'DQ==',
    });
    expect(parseClientMessage('{"v":1,"type":"inspect-actionability","requestId":"r1","sessionId":"s1","nodeId":"save"}')).toEqual({
      v: 1,
      type: 'inspect-actionability',
      requestId: 'r1',
      sessionId: 's1',
      nodeId: 'save',
    });
  });

  it('validates payload shapes', () => {
    expect(() => parseClientMessage('{"v":1,"type":"rerun","testIds":[1]}')).toThrow(UiProtocolError);
    expect(() => parseClientMessage('{"v":1,"type":"pick"}')).toThrow(/sessionId must be a string/);
  });

  it('does not accept a server message in the client direction', () => {
    expect(() => parseClientMessage('{"v":1,"type":"run-end","summary":{}}')).toThrow(UiProtocolError);
  });
});

describe('base64 payloads', () => {
  it('survives arbitrary bytes, including invalid UTF-8', () => {
    const bytes = new Uint8Array([0x1b, 0x5b, 0x41, 0xff, 0x00, 0xc3]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
