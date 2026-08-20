import { describe, expect, it } from 'vitest';
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
  it('round-trips every message the contract lists', () => {
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
        adapter: { name: 'probe-fixture', version: '0.1.0' },
        probe: {
          framework: 'fixture',
          frameworkVersion: '1.2.3',
          probeVersion: '0.1.0',
          identityKind: 'stable',
          capabilities: ['stable-identity'],
        },
        capabilities: ['tree', 'states'],
        adapterStatus: 'attached',
        columns: 80,
        rows: 24,
      },
      { v: 1, type: 'run-start', mode: 'live', startedAt: 1_700_000_000_000 },
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
        snapshot: { v: 1, sessionId: 's1', revision: 7, columns: 80, rows: 24, rootIds: [], nodes: [] },
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

  it('rejects incoherent probe health instead of displaying it', () => {
    expect(() =>
      parseServerMessage(JSON.stringify({
        v: 1,
        type: 'session',
        sessionId: 's1',
        terminalProfile: 'default',
        columns: 80,
        rows: 24,
        adapter: { name: 'probe-fixture', version: '0.1.0' },
        probe: {
          framework: 'fixture',
          probeVersion: '0.1.0',
          identityKind: 'frame-local',
          capabilities: ['stable-identity'],
        },
      })),
    ).toThrow(/frame-local/);
  });

  it('rejects probe identity without the adapter that supplied it', () => {
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
    ).toThrow(/probe requires an adapter/);
  });

  it('rejects invented, duplicate or unbounded session metadata', () => {
    const base = {
      v: 1,
      type: 'session',
      sessionId: 's1',
      terminalProfile: 'default',
      columns: 80,
      rows: 24,
      adapter: { name: 'probe-fixture', version: '0.1.0' },
    };
    expect(() =>
      parseServerMessage(JSON.stringify({ ...base, capabilities: ['tree', 'telepathy'] })),
    ).toThrow(/unsupported or duplicate/);
    expect(() =>
      parseServerMessage(JSON.stringify({ ...base, capabilities: ['tree', 'tree'] })),
    ).toThrow(/unsupported or duplicate/);
    expect(() =>
      parseServerMessage(JSON.stringify({
        ...base,
        adapter: { name: 'x'.repeat(257), version: '1' },
      })),
    ).toThrow(/bounded string/);
    expect(() =>
      parseServerMessage(JSON.stringify({ ...base, adapterStatus: 'healing' })),
    ).toThrow(/adapterStatus is invalid/);
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

  it('does not accept a client message in the server direction', () => {
    expect(() => parseServerMessage('{"v":1,"type":"stop"}')).toThrow(UiProtocolError);
  });
});

describe('client messages', () => {
  it('parses the four client types', () => {
    expect(parseClientMessage('{"v":1,"type":"stop"}')).toEqual({ v: 1, type: 'stop' });
    expect(parseClientMessage('{"v":1,"type":"rerun"}')).toEqual({ v: 1, type: 'rerun' });
    expect(parseClientMessage('{"v":1,"type":"rerun","testIds":["t1"]}')).toEqual({
      v: 1,
      type: 'rerun',
      testIds: ['t1'],
    });
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
  });

  it('validates payload shapes', () => {
    expect(() => parseClientMessage('{"v":1,"type":"rerun","testIds":[1]}')).toThrow(/array of strings/);
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
