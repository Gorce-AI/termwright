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
      resourceProfile: TERMWRIGHT_RESOURCE_PROFILES.local,
    });
    hosts.push(host);

    const first = await host.requestRun().completed;
    expect(first.state).toBe('passed');
    expect(first.catalog?.tests).toHaveLength(2);
    expect(first.catalog?.tests.map((test) => test.fullName)).toEqual(['duplicate title', 'duplicate title']);
    expect(first.catalog?.tests[0]?.resourceReservation).toEqual({
      ptySession: 2,
      externalProcess: 2,
      semanticEndpoint: 2,
      traceWriter: 2,
    });
    expect(new Set(first.catalog?.tests.map((test) => test.nativeTaskId)).size).toBe(2);
    expect(first.events.filter((event) => event.type === 'attempt.started')).toHaveLength(2);
    expect(first.events.filter((event) => event.type === 'attempt.finished')).toHaveLength(2);
    const output = first.events.filter((event) => event.type === 'test.output');
    expect(output).toHaveLength(2);
    expect(output.map((event) => (event.payload as { stream: string }).stream).sort()).toEqual(['stderr', 'stdout']);
    expect(output.every((event) => event.identity.attemptId?.startsWith('attempt:'))).toBe(true);
    expect(new Set(output.map((event) => event.identity.attemptId)).size).toBe(2);
    expect(output.every((event) => (event.payload as { taskAttributed: boolean }).taskAttributed)).toBe(true);

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
