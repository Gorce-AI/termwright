import { describe, expect, it } from 'vitest';
import type { TraceWriter } from '@termwright/trace';
import { registerAssertionRecording } from './assertion-recording.js';
import { enterScope, recordAssert, type AssertRecord } from './trace-context.js';
import { resolveTermwrightConfig } from './config.js';
import { runWithoutAttemptContextForTesting } from './attempt-context.js';

registerAssertionRecording();

async function capture(body: () => unknown): Promise<AssertRecord[]> {
  const records: AssertRecord[] = [];
  const exit = enterScope({
    testId: 'recording',
    testName: 'recording',
    testFile: '/recording.test.ts',
    config: resolveTermwrightConfig({}, {}),
    traces: [],
    writers: [
      { recordAssert: (record: AssertRecord) => records.push(record) } as unknown as TraceWriter,
    ],
  });
  try {
    await body();
  } finally {
    exit();
  }
  return records;
}

describe('ordinary assertion recording', () => {
  it('records successful, negated and failed builtins once each without inventing selectors', async () => {
    const records = await capture(() => {
      expect(0).toBe(0);
      expect('draft').not.toBe('sent');
      expect({ count: 0 }).toMatchObject({ count: 0 });
      try {
        expect(1).toBe(0);
      } catch {
        /* expected failure */
      }
      try {
        expect({ count: 1 }).toMatchObject({ count: 0 });
      } catch {
        /* expected failure */
      }
    });
    expect(records.map(({ api, ok }) => ({ api, ok }))).toEqual([
      { api: 'toBe', ok: true },
      { api: 'not.toBe', ok: true },
      { api: 'toMatchObject', ok: true },
      { api: 'toBe', ok: false },
      { api: 'toMatchObject', ok: false },
    ]);
    expect(records.every((record) => record.selector === undefined)).toBe(true);
    expect(records[3]?.error).toContain('expected 1 to be +0');
  });

  it('covers local context expect, resolved/rejected promises and wrong promise polarity', async ({
    expect: localExpect,
  }) => {
    const records = await capture(async () => {
      localExpect(0).toBe(0);
      await localExpect(Promise.resolve(1)).resolves.not.toBe(0);
      await expect(Promise.reject(new Error('known'))).rejects.toThrow('known');
      try {
        await expect(Promise.resolve(0)).rejects.not.toBe(1);
      } catch {
        /* expected failure */
      }
      try {
        await expect(Promise.reject(new Error('wrong'))).resolves.toBe(0);
      } catch {
        /* expected failure */
      }
    });
    expect(records.map(({ api, ok }) => ({ api, ok }))).toEqual([
      { api: 'toBe', ok: true },
      { api: 'resolves.not.toBe', ok: true },
      { api: 'rejects.toThrow', ok: true },
      { api: 'rejects.not.toBe', ok: false },
      { api: 'resolves.toBe', ok: false },
    ]);
  });

  it('observes user extensions and retains a detailed locator result without duplicating it', async () => {
    expect.extend({
      toBePositive(received: number) {
        return { pass: received > 0, message: () => 'expected positive' };
      },
      async toMatchRecordedTarget() {
        recordAssert({
          api: 'toMatchRecordedTarget',
          ok: true,
          selector: 'getByRole("button")',
          ref: 'semantic:approve@2',
        });
        return { pass: true, message: () => 'target' };
      },
    });
    const records = await capture(async () => {
      (expect(1) as unknown as { toBePositive(): void }).toBePositive();
      await (
        expect({}) as unknown as { toMatchRecordedTarget(): Promise<void> }
      ).toMatchRecordedTarget();
    });
    expect(records).toEqual([
      { api: 'toBePositive', ok: true },
      {
        api: 'toMatchRecordedTarget',
        ok: true,
        selector: 'getByRole("button")',
        ref: 'semantic:approve@2',
      },
    ]);
  });

  it('records a poll only when it settles, including a failing callback', async () => {
    let probes = 0;
    const records = await capture(async () => {
      await expect.poll(() => ++probes, { interval: 1 }).toBe(3);
      try {
        await expect.poll(() => 1, { interval: 1, timeout: 5 }).toBe(2);
      } catch {
        /* expected failure */
      }
      try {
        await expect
          .poll(
            () => {
              throw new Error('callback');
            },
            { interval: 1, timeout: 5 },
          )
          .toBe(2);
      } catch {
        /* expected failure */
      }
    });
    expect(records.map(({ api, ok }) => ({ api, ok }))).toEqual([
      { api: 'toBe', ok: true },
      { api: 'toBe', ok: false },
      { api: 'toBe', ok: false },
    ]);
  });

  it('preserves soft failures and does not confuse concurrent matcher outcomes', async () => {
    const task = { result: { state: 'run', errors: [] } };
    const withTask = (value: unknown) =>
      (
        expect.soft(value) as unknown as {
          withTest(task: unknown): import('@vitest/expect').Assertion;
        }
      ).withTest(task);
    const records = await capture(async () => {
      withTask(1).toBe(0);
      await Promise.all([
        withTask(Promise.resolve(1)).resolves.toBe(0),
        withTask(Promise.resolve(0)).resolves.toBe(0),
        withTask(Promise.reject(new Error('wrong'))).resolves.toBe(0),
      ]);
    });
    expect(task.result.state).toBe('fail');
    expect(task.result.errors).toHaveLength(3);
    expect(records.filter((record) => !record.ok)).toHaveLength(3);
    expect(records.filter((record) => record.ok)).toHaveLength(1);
  });

  it('preserves a domain matcher takeover of the engine poll loop', async () => {
    const matcher = () => ({ pass: true, message: () => 'taken over' });
    Object.defineProperty(matcher, '__vitest_poll_takeover__', { value: true });
    expect.extend({ toTakeOver: matcher });
    let probes = 0;
    const records = await capture(async () => {
      await (
        expect.poll(() => ++probes) as unknown as { toTakeOver(): Promise<void> }
      ).toTakeOver();
    });
    expect(probes).toBe(0);
    expect(records).toEqual([{ api: 'toTakeOver', ok: true }]);
  });

  it('stays inert outside an attempt', () => {
    runWithoutAttemptContextForTesting(() => expect(0).toBe(0));
  });
});
