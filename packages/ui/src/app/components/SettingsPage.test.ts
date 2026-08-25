import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../preferences.js';
import { initialAppState, type SessionRecord } from '../domain/model.js';
import { frameworkContract } from '../../__fixtures__/fake-session.js';
import { buildDiagnosticReport } from './SettingsPage.js';

describe('diagnostic report', () => {
  it('uses a strict operational allowlist and excludes content-bearing fields', () => {
    const sentinel = 'DO-NOT-EXFILTRATE';
    const session: SessionRecord = {
      runId: 'safe-run',
      sessionId: sentinel,
      columns: 80,
      rows: 24,
      terminalProfile: 'default',
      command: [sentinel],
      writable: false,
      contract: frameworkContract(sentinel, 'ink', '5'),
      output: [sentinel],
      logs: [{ t: 1, source: 'file', level: null, message: sentinel }],
      revision: null,
      snapshot: null,
    };
    const state = {
      ...initialAppState,
      boot: 'ready' as const,
      project: { name: sentinel, root: sentinel, branch: sentinel, version: '0.1.0' },
      connected: true,
      canRun: true,
      sessions: { [sentinel]: session },
      executions: [{
        caseKey: 'safe-case', runId: 'safe-run', executionId: 'safe-execution', provider: '@termwright/test', kind: 'test' as const,
        title: sentinel, ancestors: [], tags: [], source: { file: sentinel }, status: 'failed' as const, attempt: 1, priorFailures: [], flaky: false,
        error: sentinel, lostLogRecords: 0, sessionIds: [sentinel], nodes: [],
      }],
    };
    const serialized = JSON.stringify(buildDiagnosticReport(state, { live: true, history: true, openTrace: true }, DEFAULT_PREFERENCES, true));
    expect(serialized).not.toContain(sentinel);
    expect(serialized).toContain('"version":"0.1.0"');
    expect(serialized).toContain('ink@5');
    expect(serialized).toContain('"count":1');
  });
});
