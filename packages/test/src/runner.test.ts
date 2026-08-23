import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createRunId } from '@termwright/protocol';
import { ResourceBroker } from '@termwright/resource-broker';
import { startResourceBrokerServer } from '@termwright/resource-broker/transport';
import { startRunJournalServer } from '@termwright/run-journal-transport';
import type { RunEvent } from '@termwright/protocol/run-events';
import {
  assertCertifiedVitestRuntime,
  CERTIFIED_VITEST_VERSION,
  certifiedTryOrdinal,
  installedVitestVersion,
  validateHostContext,
} from './runner.js';

const execute = promisify(execFile);

/**
 * Absolute path to Vitest's CLI entry.
 *
 * `vitest/vitest.mjs` is not a declared subpath — Vitest 4 tightened its
 * exports map and the specifier no longer resolves. The bin field is the
 * supported way to find it, and it works across both lines.
 */
function vitestCliPath(): string {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('vitest/package.json');
  const manifest = require('vitest/package.json') as { readonly bin?: Record<string, string> | string };
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['vitest'];
  if (entry === undefined) throw new Error('the installed Vitest package declares no vitest bin');
  return join(dirname(manifestPath), entry);
}
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('exact Vitest certification', () => {
  it('pins the runtime whose native try hook Termwright consumes', () => {
    expect(installedVitestVersion()).toBe(CERTIFIED_VITEST_VERSION);
    expect(CERTIFIED_VITEST_VERSION).toBe('4.1.11');
    expect(() => assertCertifiedVitestRuntime()).not.toThrow();
    expect(() => assertCertifiedVitestRuntime('4.1.10')).toThrow(/exact-certified for 4\.1\.11/u);
  });

  it('fails closed if the certified hook omits either native ordinal', () => {
    expect(certifiedTryOrdinal({ retry: 2, repeats: 3 })).toEqual({ retry: 2, repeats: 3 });
    expect(() => certifiedTryOrdinal({ retry: 0 })).toThrow(/compatibility violation/u);
    expect(() => certifiedTryOrdinal({ retry: -1, repeats: 0 })).toThrow(/compatibility violation/u);
    expect(() => certifiedTryOrdinal(undefined)).toThrow(/compatibility violation/u);
  });

  it('accepts only a complete host hierarchy keyed by native task id', () => {
    const broker = {
      endpoint: '/tmp/termwright-runner-test.sock', token: 'x'.repeat(32), workerEpoch: 0,
      workerIdPrefix: 'runner-test', handshakeTimeoutMs: 5_000, resourceProfile: {},
    } as const;
    const context = {
      invocationId: createRunId('invocation'),
      runId: createRunId('run'),
      tasks: {
        native_1: {
          runnerTaskId: createRunId('runner-task'),
          projectId: createRunId('project'),
          specId: createRunId('spec'),
          file: '/workspace/example.test.ts',
          fullName: 'example test',
          resourceReservation: { ptySession: 2, externalProcess: 2, semanticEndpoint: 2 },
        },
      },
      broker,
      journal: {
        endpoint: '/tmp/termwright-journal-test.sock', token: 'j'.repeat(32), handshakeTimeoutMs: 5_000,
        acknowledgementTimeoutMs: 5_000,
        binding: 'host-assigned-worker' as const,
      },
    } as const;
    expect(validateHostContext(context)).toEqual(context);
    expect(() => validateHostContext({ mode: 'all' })).toThrow(/TermwrightTestHost/u);
    expect(() => validateHostContext({ ...context, invocationId: 'invocation:bad' })).toThrow(/canonical/u);
    expect(() => validateHostContext({ ...context, unexpected: true })).toThrow(/TermwrightTestHost/u);
    expect(() => validateHostContext({ ...context, broker: undefined })).toThrow(/TermwrightTestHost/u);
    expect(() => validateHostContext({ ...context, journal: undefined })).toThrow(/TermwrightTestHost/u);
    expect(() => validateHostContext({
      ...context,
      tasks: {
        native_1: { ...context.tasks.native_1, resourceReservation: { ptySession: -1 } },
      },
    })).toThrow(/TermwrightTestHost/u);
    const shared = context.tasks.native_1;
    expect(() => validateHostContext({
      ...context,
      tasks: { native_1: shared, native_2: { ...shared, projectId: createRunId('project') } },
    })).toThrow(/TermwrightTestHost/u);
    const accessor = Object.defineProperty({}, 'tasks', { enumerable: true, get: () => context.tasks });
    expect(() => validateHostContext(accessor)).toThrow(/TermwrightTestHost/u);
    expect(Object.isFrozen(validateHostContext(context))).toBe(true);
    expect(Object.isFrozen(validateHostContext(context).tasks.native_1)).toBe(true);
  });
});

describe('native AttemptContext', () => {
  it('isolates concurrent duplicate titles and covers repeat/retry fixture cleanup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-attempt-context-'));
    directories.push(directory);
    const output = join(directory, 'events.jsonl');
    const vitest = vitestCliPath();
    const config = fileURLToPath(new URL('__fixtures__/attempt-context.vitest.config.ts', import.meta.url));
    const runId = createRunId('run');
    const broker = new ResourceBroker({ runId, capacities: {
      ptySession: 4, externalProcess: 4, semanticEndpoint: 4, traceWriter: 4,
    } });
    const server = await startResourceBrokerServer({ broker, runId });
    const journalEvents: RunEvent[] = [];
    let hostileTerminalObservedAfterUserFailure = false;
    let soleFinishedFailureObservedBeforeTerminal = false;
    const journal = await startRunJournalServer({ runId, append: async (event) => {
      journalEvents.push(event);
      if (event.type === 'attempt.finished' &&
          (event.payload as { state?: string }).state === 'failed') {
        const written = await readFile(output, 'utf8').catch(() => '');
        const hostile = written.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((entry) => entry['phase'] === 'hostile-user-failed');
        if (hostile !== undefined && hostile['nativeTaskId'] ===
            (event.payload as { nativeTaskId?: string }).nativeTaskId) {
          hostileTerminalObservedAfterUserFailure = true;
        }
        const sole = written.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((entry) => entry['phase'] === 'only-user-finished-failed');
        if (sole !== undefined && sole['nativeTaskId'] ===
            (event.payload as { nativeTaskId?: string }).nativeTaskId) {
          soleFinishedFailureObservedBeforeTerminal = true;
        }
      }
    } });
    try {
      await execute(process.execPath, [vitest, 'run', '--config', config], {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        env: {
          ...process.env,
          TERMWRIGHT_ATTEMPT_CONTEXT_OUTPUT: output,
          TERMWRIGHT_TEST_BROKER_ENDPOINT: server.endpoint,
          TERMWRIGHT_TEST_BROKER_TOKEN: server.token,
          TERMWRIGHT_TEST_RUN_ID: runId,
          TERMWRIGHT_TEST_JOURNAL_ENDPOINT: journal.endpoint,
          TERMWRIGHT_TEST_JOURNAL_TOKEN: journal.token,
        },
        timeout: 30_000,
      });
    } finally {
      await journal.close();
      await server.close();
    }

    const records = (await readFile(output, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    const duplicateCallbacks = records.filter((entry) => entry['phase'] === 'callback' && String(entry['label']).startsWith('duplicate-'));
    expect(new Set(duplicateCallbacks.map((entry) => entry['runnerTaskId'])).size).toBe(2);
    expect(new Set(duplicateCallbacks.map((entry) => entry['attemptId'])).size).toBe(2);
    expect(duplicateCallbacks.every((entry) => /^runner-task:[0-9a-f-]+$/u.test(String(entry['runnerTaskId'])))).toBe(true);
    expect(records.some((entry) => entry['phase'] === 'callback' && entry['label'] === 'brokered-terminal')).toBe(true);
    expect(server.snapshot().active).toEqual([]);
    const byAttempt = new Map<string | undefined, RunEvent[]>();
    for (const event of journalEvents) {
      const events = byAttempt.get(event.identity.attemptId) ?? [];
      events.push(event);
      byAttempt.set(event.identity.attemptId, events);
    }
    expect(byAttempt.size).toBe(10);
    for (const events of byAttempt.values()) {
      const lifecycle = events.filter((event) => event.type.startsWith('attempt.'));
      expect(lifecycle.map((event) => event.type)).toEqual(['attempt.started', 'attempt.finished']);
      expect(lifecycle[0]?.identity).toEqual(lifecycle[1]?.identity);
    }
    expect(journalEvents.filter((event) => event.identity.sessionId !== undefined).map((event) => event.type))
      .toEqual(['session.started', 'action.started', 'action.finished', 'session.exit', 'session.finished']);
    expect(journalEvents.filter((event) => event.identity.stepId !== undefined).map((event) => event.type))
      .toEqual(['step.started', 'action.started', 'action.finished', 'step.finished']);
    expect(journalEvents.filter((event) => event.type === 'action.finished')[0]?.identity.actionId)
      .toMatch(/^action:/u);
    expect(journalEvents.filter((event) => event.type === 'attempt.finished').map((event) =>
      (event.payload as { state: string }).state)).toEqual(expect.arrayContaining(['passed', 'failed', 'skipped']));
    expect(hostileTerminalObservedAfterUserFailure).toBe(true);
    expect(soleFinishedFailureObservedBeforeTerminal).toBe(true);

    const repeated = records.filter((entry) => entry['label'] === 'repeat-retry');
    const callbackAttempts = repeated.filter((entry) => entry['phase'] === 'callback');
    expect(callbackAttempts.map((entry) => [entry['repeat'], entry['retry']])).toEqual([
      [0, 0], [0, 1], [1, 0], [1, 1],
    ]);
    expect(new Set(callbackAttempts.map((entry) => entry['attemptId'])).size).toBe(4);
    expect(new Set(callbackAttempts.filter((entry) => entry['repeat'] === 0).map((entry) => entry['executionId'])).size).toBe(1);
    expect(new Set(callbackAttempts.filter((entry) => entry['repeat'] === 1).map((entry) => entry['executionId'])).size).toBe(1);
    expect(callbackAttempts[0]?.['executionId']).not.toBe(callbackAttempts.at(-1)?.['executionId']);
    expect(new Set(callbackAttempts.map((entry) => entry['invocationId'])).size).toBe(1);
    expect(new Set(callbackAttempts.map((entry) => entry['runId'])).size).toBe(1);
    expect(new Set(callbackAttempts.map((entry) => entry['projectId'])).size).toBe(1);
    expect(new Set(callbackAttempts.map((entry) => entry['specId'])).size).toBe(1);

    for (const callback of callbackAttempts) {
      const attemptId = callback['attemptId'];
      for (const phase of ['before-each', 'fixture-before', 'callback', 'after-each', 'fixture-cleanup', 'on-finished']) {
        expect(repeated.some((entry) => entry['phase'] === phase && entry['attemptId'] === attemptId)).toBe(true);
      }
    }
  }, 40_000);

  it('fails resource acquisition before spawning the terminal process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-broker-denied-'));
    directories.push(directory);
    const marker = join(directory, 'spawned');
    const vitest = vitestCliPath();
    const config = fileURLToPath(new URL('__fixtures__/broker-denied.vitest.config.ts', import.meta.url));
    const runId = createRunId('run');
    const broker = new ResourceBroker({ runId, capacities: {
      ptySession: 0, externalProcess: 0, semanticEndpoint: 0, traceWriter: 0,
    } });
    const server = await startResourceBrokerServer({ broker, runId });
    const journalEvents: RunEvent[] = [];
    const journal = await startRunJournalServer({ runId, append: (event) => { journalEvents.push(event); } });
    try {
      await expect(execute(process.execPath, [vitest, 'run', '--config', config], {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        env: {
          ...process.env,
          TERMWRIGHT_TEST_BROKER_ENDPOINT: server.endpoint,
          TERMWRIGHT_TEST_BROKER_TOKEN: server.token,
          TERMWRIGHT_TEST_RUN_ID: runId,
          TERMWRIGHT_DENIED_SPAWN_MARKER: marker,
          TERMWRIGHT_TEST_JOURNAL_ENDPOINT: journal.endpoint,
          TERMWRIGHT_TEST_JOURNAL_TOKEN: journal.token,
        },
        timeout: 30_000,
      })).rejects.toMatchObject({ code: expect.any(Number) });
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(server.snapshot().active).toEqual([]);
      expect(server.snapshot().queue).toEqual([]);
      expect(journalEvents.map((event) => [event.type, (event.payload as { state?: string }).state])).toEqual([
        ['attempt.started', undefined], ['attempt.finished', 'failed'],
      ]);
    } finally {
      await journal.close();
      await server.close();
    }
  }, 40_000);
});
