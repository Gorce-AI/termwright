import { describe, expect, it } from 'vitest';
import type { TraceWriter } from '@termwright/trace';
import { createRunId } from '@termwright/protocol';
import { resolveTermwrightConfig } from './config.js';
import {
  currentScope,
  attachWriter,
  beginStep,
  enterScope,
  openStep,
  recordAssert,
  type TermwrightScope,
} from './trace-context.js';
import {
  createAttemptContext,
  installAttemptEventRecorder,
  runWithAttemptContext,
  runWithoutAttemptContextForTesting,
} from './attempt-context.js';
import { unitAttemptOptions } from './__fixtures__/attempt-options.js';

interface Recorded {
  readonly asserts: unknown[];
  readonly steps: { title: string; status?: string | undefined }[];
}

function fakeWriter(): { writer: TraceWriter; recorded: Recorded } {
  const recorded: Recorded = { asserts: [], steps: [] };
  const writer = {
    recordAssert: (assertion: unknown) => recorded.asserts.push(assertion),
    addStep: (title: string) => {
      const entry: { title: string; status?: string | undefined } = { title };
      recorded.steps.push(entry);
      return {
        stepId: `s${recorded.steps.length}`,
        title,
        end: (status?: string) => {
          entry.status = status;
        },
      };
    },
  };
  return { writer: writer as unknown as TraceWriter, recorded };
}

function scope(name: string, writers: TraceWriter[] = []): TermwrightScope {
  return {
    testId: name,
    testName: name,
    testFile: '/repo/a.test.ts',
    config: resolveTermwrightConfig({}, {}),
    writers,
    traces: [],
  };
}

function attempt<T>(name: string, body: () => T): T {
  return runWithAttemptContext(
    createAttemptContext(
      {
        invocationId: createRunId('invocation'),
        runId: createRunId('run'),
        projectId: createRunId('project'),
        specId: createRunId('spec'),
        runnerTaskId: createRunId('runner-task'),
        nativeTaskId: name,
        file: '/repo/a.test.ts',
        fullName: name,
      },
      0,
      0,
      unitAttemptOptions(),
    ),
    () => {
      installAttemptEventRecorder({ record: () => undefined, flush: async () => undefined });
      return body();
    },
  );
}

describe('the attempt-local scope', () => {
  it('finds only the scope bound to the current attempt', () =>
    attempt('one', () => {
      const first = scope('one');
      const exit = enterScope(first);
      expect(currentScope()).toBe(first);
      exit();
    }));

  it('restores the outer concurrent async context instead of using a last-active fallback', () =>
    attempt('one', () => {
      const first = scope('one');
      const second = scope('two');
      const exitFirst = enterScope(first);
      attempt('two', () => {
        const exitSecond = enterScope(second);
        expect(currentScope()).toBe(second);
        exitSecond();
      });
      expect(currentScope()).toBe(first);
      exitFirst();
    }));

  it('forgets a scope once it exits, and tolerates a double exit', () =>
    attempt('one', () => {
      const only = scope('one');
      const exit = enterScope(only);
      expect(currentScope()).toBe(only);
      exit();
      exit();
      expect(currentScope()).toBeUndefined();
    }));

  it('fails closed outside a certified native attempt', () => {
    runWithoutAttemptContextForTesting(() => {
      expect(() => currentScope()).toThrow(/exact-certified Termwright runner/u);
    });
  });
});

describe('recording', () => {
  it('writes assertions to every writer of the current scope', () =>
    attempt('one', () => {
      const a = fakeWriter();
      const b = fakeWriter();
      const exit = enterScope(scope('one', [a.writer, b.writer]));
      recordAssert({ api: 'toBeVisible', ok: false, selector: 'button', error: 'hidden' });
      expect(a.recorded.asserts).toEqual([
        { api: 'toBeVisible', ok: false, selector: 'button', error: 'hidden' },
      ]);
      expect(b.recorded.asserts).toHaveLength(1);
      exit();
    }));

  it('omits absent fields rather than sending undefined', () =>
    attempt('one', () => {
      const a = fakeWriter();
      const exit = enterScope(scope('one', [a.writer]));
      recordAssert({ api: 'toHaveText', ok: true });
      expect(a.recorded.asserts).toEqual([{ api: 'toHaveText', ok: true }]);
      exit();
    }));

  it('rejects recording outside a test', () => {
    runWithoutAttemptContextForTesting(() => {
      expect(() => recordAssert({ api: 'toBeVisible', ok: true })).toThrow(/exact-certified/u);
      expect(() => openStep('orphan')).toThrow(/exact-certified/u);
    });
  });

  it('opens one step handle per writer', () =>
    attempt('one', () => {
      const a = fakeWriter();
      const b = fakeWriter();
      const only = scope('one', [a.writer, b.writer]);
      const exit = enterScope(only);
      const handles = openStep('log in', only);
      expect(handles).toHaveLength(2);
      for (const handle of handles) handle.end('failed', 'boom');
      expect(a.recorded.steps).toEqual([{ title: 'log in', status: 'failed' }]);
      exit();
    }));

  it('re-opens an active authored step on a trace writer launched inside it', () =>
    attempt('gherkin', () => {
      const only = scope('gherkin');
      const exit = enterScope(only);
      const active = beginStep(
        'Given a terminal is running',
        {
          gherkin: {
            keyword: 'Given',
            text: 'a terminal is running',
            source: { file: '/repo/demo.feature', line: 4, column: 5 },
          },
        },
        only,
      );
      const late = fakeWriter();
      attachWriter(only, late.writer);
      active.end('passed');
      expect(active.stepId).toMatch(/^step:[0-9a-f-]+$/u);
      expect(late.recorded.steps).toEqual([
        { title: 'Given a terminal is running', status: 'passed' },
      ]);
      exit();
    }));
});
