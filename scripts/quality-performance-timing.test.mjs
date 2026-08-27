import { describe, expect, it } from 'vitest';
import { summarizeQualityTiming } from './quality-performance-timing.mjs';

describe('quality performance timing', () => {
  it('uses logical ordering and monotonic durations when wall time moves backwards', () => {
    const later = manifest({
      run: 2,
      seq: 20,
      startedAt: 500,
      finishedAt: 100,
      durationMs: 80,
      attemptStart: 30,
      attemptFinish: 50,
      attemptDuration: 200,
    });
    const first = manifest({
      run: 1,
      seq: 10,
      startedAt: 1_000,
      finishedAt: 2_000,
      durationMs: 100,
      attemptStart: 40,
      attemptFinish: 65,
      attemptDuration: 250,
    });
    expect(summarizeQualityTiming([later, first])).toEqual({
      firstRunPreAttemptMs: 40,
      postStartupRunOrchestrationMs: 60,
    });
  });

  it('fails closed for retries, multiple attempts and mixed host invocations', () => {
    const valid = manifest({
      run: 1,
      seq: 10,
      durationMs: 100,
      attemptStart: 40,
      attemptFinish: 65,
      attemptDuration: 25,
    });
    expect(() =>
      summarizeQualityTiming([
        valid,
        {
          ...manifest({ run: 2, seq: 20 }),
          attempts: [{ ...manifest({ run: 2, seq: 20 }).attempts[0], retry: 1 }],
        },
      ]),
    ).toThrow(/invalid attempt/u);
    expect(() =>
      summarizeQualityTiming([
        valid,
        { ...manifest({ run: 2, seq: 20 }), invocationId: 'invocation:other' },
      ]),
    ).toThrow(/one logical host invocation/u);
    expect(() =>
      summarizeQualityTiming([
        valid,
        manifest({ run: 2, seq: 20, durationMs: 100, attemptStart: 90, attemptFinish: 170 }),
      ]),
    ).toThrow(/invalid host-monotonic duration/u);
  });
});

function manifest({
  run,
  seq,
  startedAt = 0,
  finishedAt = 0,
  durationMs = 50,
  attemptStart = 10,
  attemptFinish = 15,
  attemptDuration = 5,
}) {
  return {
    invocationId: 'invocation:timing',
    runId: `run:${run}`,
    startedAt,
    finishedAt,
    durationMs,
    status: 'passed',
    attempts: [
      {
        status: 'passed',
        retry: 0,
        repeat: 0,
        durationMs: attemptDuration,
        startedAfterRunMs: attemptStart,
        finishedAfterRunMs: attemptFinish,
      },
    ],
    events: [{ type: 'run.configuration', producerId: 'producer:host', epoch: 0, seq }],
  };
}
