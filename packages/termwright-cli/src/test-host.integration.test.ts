import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TERMWRIGHT_RESOURCE_PROFILES, TermwrightTestHost } from './test-host.js';

const hosts: TermwrightTestHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('TermwrightTestHost over the exact Vitest engine', () => {
  it('collects duplicate names by native id and reruns one task in the same engine', async () => {
    const host = await TermwrightTestHost.open({
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      runsDir: await mkdtemp(join(tmpdir(), 'termwright-host-integration-history-')),
      vitestArgs: [
        '--config',
        fileURLToPath(new URL('__fixtures__/native-host.vitest.config.ts', import.meta.url)),
        '--reporter=dot',
      ],
      workerEnv: {
        TERMWRIGHT_WORKER_ENV_PROBE: 'exact',
        TERMWRIGHT_REQUIRE_GO: '1',
      },
      resourceProfile: TERMWRIGHT_RESOURCE_PROFILES.local,
    });
    hosts.push(host);

    const first = await host.requestRun().completed;
    // Assert the reason before the verdict. A nested host that fails on
    // infrastructure carries why in `error`, and checking only the state
    // reports "expected infrastructure-failed to be passed" — a rare failure
    // that then cannot be diagnosed from the CI log it appeared in.
    expect(first.error ?? null).toBeNull();
    expect(first.state).toBe('passed');
    expect(first.catalog?.tests).toHaveLength(2);
    expect(first.catalog?.tests.map((test) => test.fullName)).toEqual(['duplicate title', 'duplicate title']);
    expect(first.catalog?.tests[0]?.resourceReservation).toEqual({
      ptySession: 2,
      externalProcess: 2,
      semanticEndpoint: 2,
      nativeHostPressure: 2,
      traceWriter: 2,
    });
    expect(new Set(first.catalog?.tests.map((test) => test.nativeTaskId)).size).toBe(2);
    expect(first.events.filter((event) => event.type === 'attempt.started')).toHaveLength(2);
    expect(first.events.filter((event) => event.type === 'attempt.finished')).toHaveLength(2);
    const output = first.events.filter((event) => event.type === 'test.output');
    expect(output).toHaveLength(2);
    expect(output.map((event) => (event.payload as { stream: string }).stream).sort()).toEqual(['stderr', 'stdout']);
    const contentByStream = new Map(output.map((event) => {
      const payload = event.payload as { stream: string; content: string };
      return [payload.stream, payload.content] as const;
    }));
    expect(contentByStream.get('stdout')).toContain('native-host-output:attempt:');
    expect(contentByStream.get('stderr')).toContain('native-host-stderr-fixture:attempt:');
    // Vitest delivers console output on its own schedule, so a line written
    // just before a test returns can arrive after that attempt has finished,
    // and the journal forbids any event after attempt.finished — the id is
    // legitimately absent then, which is what taskAttributed reports. The
    // guarantee that matters is the other one: a line must never land on a
    // different test's attempt, and it must always name its own task.
    const startedFor = new Map(first.events
      .filter((event) => event.type === 'attempt.started')
      .map((event) => [(event.payload as { nativeTaskId: string }).nativeTaskId, event.identity.attemptId]));
    expect(startedFor.size).toBe(2);
    for (const event of output) {
      const task = (event.payload as { nativeTaskId?: string }).nativeTaskId;
      expect(task).toBeDefined();
      expect(event.identity.runnerTaskId).toBeDefined();
      const attributed = (event.payload as { taskAttributed: boolean }).taskAttributed;
      expect(attributed).toBe(event.identity.attemptId !== undefined);
      if (event.identity.attemptId !== undefined) {
        expect(event.identity.attemptId).toBe(startedFor.get(task!));
      }
    }
    expect(new Set(output.map((event) => (event.payload as { nativeTaskId: string }).nativeTaskId)).size).toBe(2);

    const selected = first.catalog?.tests[1]?.runnerTaskId;
    expect(selected).toBeDefined();
    const second = await host.requestRun({ runnerTaskIds: [selected!] }).completed;
    expect(second.state).toBe('passed');
    expect(second.catalog?.tests).toHaveLength(2);
    const attempts = second.events.filter((event) => event.type.startsWith('attempt.'));
    expect(attempts.map((event) => event.type)).toEqual(['attempt.started', 'attempt.finished']);
    expect(new Set(attempts.map((event) => event.identity.attemptId)).size).toBe(1);
    expect(attempts.every((event) => event.identity.runId === second.runId)).toBe(true);
    expect(attempts.every((event) => event.identity.runnerTaskId === selected)).toBe(true);
    expect(second.events.at(-1)?.payload).toEqual({ state: 'passed' });
  }, 20_000);
});
