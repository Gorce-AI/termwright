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
      { v: 1, type: 'session', sessionId: 's1', terminalProfile: 'default', columns: 80, rows: 24 },
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
      },
      { v: 1, type: 'run-end', summary: { total: 1, passed: 0, failed: 1, skipped: 0, flaky: 1, durationMs: 900 } },
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
