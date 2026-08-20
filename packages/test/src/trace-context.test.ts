import { afterEach, describe, expect, it } from 'vitest';
import type { TraceWriter } from '@termwright/trace';
import { resolveTermwrightConfig } from './config.js';
import {
  currentScope,
  attachWriter,
  beginStep,
  enterScope,
  openStep,
  recordAssert,
  scopeKey,
  type TermwrightScope,
} from './trace-context.js';

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

const exits: (() => void)[] = [];

afterEach(() => {
  while (exits.length > 0) (exits.pop() as () => void)();
});

function enter(value: TermwrightScope): void {
  exits.push(enterScope(value));
}

describe('the scope registry', () => {
  it('finds a scope by test file and name', () => {
    const first = scope('one');
    enter(first);
    expect(currentScope(scopeKey('/repo/a.test.ts', 'one'))).toBe(first);
  });

  it('prefers the addressed scope over the most recent one', () => {
    const first = scope('one');
    const second = scope('two');
    enter(first);
    enter(second);
    expect(currentScope(scopeKey('/repo/a.test.ts', 'one'))).toBe(first);
    expect(currentScope()).toBe(second);
    expect(currentScope('unknown')).toBe(second);
  });

  it('forgets a scope once it exits, and tolerates a double exit', () => {
    const only = scope('one');
    const exit = enterScope(only);
    expect(currentScope()).toBe(only);
    exit();
    exit();
    expect(currentScope(scopeKey('/repo/a.test.ts', 'one'))).toBeUndefined();
  });
});

describe('recording', () => {
  it('writes assertions to every writer of the addressed scope', () => {
    const a = fakeWriter();
    const b = fakeWriter();
    enter(scope('one', [a.writer, b.writer]));
    enter(scope('two', [fakeWriter().writer]));
    recordAssert({ api: 'toBeVisible', ok: false, selector: 'button', error: 'hidden' }, scopeKey('/repo/a.test.ts', 'one'));
    expect(a.recorded.asserts).toEqual([
      { api: 'toBeVisible', ok: false, selector: 'button', error: 'hidden' },
    ]);
    expect(b.recorded.asserts).toHaveLength(1);
  });

  it('omits absent fields rather than sending undefined', () => {
    const a = fakeWriter();
    enter(scope('one', [a.writer]));
    recordAssert({ api: 'toHaveText', ok: true });
    expect(a.recorded.asserts).toEqual([{ api: 'toHaveText', ok: true }]);
  });

  it('is a no-op outside a test', () => {
    expect(() => recordAssert({ api: 'toBeVisible', ok: true })).not.toThrow();
    expect(openStep('orphan')).toEqual([]);
  });

  it('opens one step handle per writer', () => {
    const a = fakeWriter();
    const b = fakeWriter();
    const only = scope('one', [a.writer, b.writer]);
    enter(only);
    const handles = openStep('log in', only);
    expect(handles).toHaveLength(2);
    for (const handle of handles) handle.end('failed', 'boom');
    expect(a.recorded.steps).toEqual([{ title: 'log in', status: 'failed' }]);
  });

  it('re-opens an active authored step on a trace writer launched inside it', () => {
    const only = scope('gherkin');
    enter(only);
    const active = beginStep('Given a terminal is running', {
      gherkin: {
        keyword: 'Given', text: 'a terminal is running',
        source: { file: '/repo/demo.feature', line: 4, column: 5 },
      },
    }, only);
    const late = fakeWriter();
    attachWriter(only, late.writer);
    active.end('passed');
    expect(active.stepId).toBe('tw-step-1');
    expect(late.recorded.steps).toEqual([{ title: 'Given a terminal is running', status: 'passed' }]);
  });
});
