import { describe, expect, it } from 'vitest';
import { AttemptBudgetExceededError, TestBudget } from './attempt-budget.js';

function clock(start = 0): { now(): number; advance(ms: number): void } {
  let value = start;
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

const reserves = { diagnosticsMs: 10, traceFlushMs: 10, teardownMs: 10 } as const;

describe('TestBudget', () => {
  it('shares one deadline across fixture, action, assertion and cleanup phases', () => {
    const time = clock();
    const budget = new TestBudget(100, reserves, time.now);
    budget.enter('before-each');
    time.advance(20);
    budget.enter('fixture');
    expect(budget.operationTimeout(50, 'operation')).toBe(50);
    time.advance(40);
    expect(budget.operationTimeout(50, 'assertion')).toBe(10);
    time.advance(10);
    expect(() => budget.operationTimeout(1, 'operation')).toThrow(AttemptBudgetExceededError);
    budget.mark('cleanup');
    expect(budget.remaining()).toBe(30);
  });

  it('keeps a bounded authoritative finalization allowance after user timeout', () => {
    let now = 0;
    const budget = new TestBudget(
      5_000,
      {
        diagnosticsMs: 250,
        traceFlushMs: 500,
        teardownMs: 1_000,
      },
      () => now,
    );
    now = 5_003;

    expect(budget.finalizationTimeout(5_000)).toBe(1_000);
    expect(budget.phase).toBe('cleanup');
    expect(() => budget.operationTimeout(1)).toThrow(AttemptBudgetExceededError);
  });

  it('preserves explicit diagnostics, trace flush and teardown reserves', () => {
    const time = clock();
    const budget = new TestBudget(100, reserves, time.now);
    time.advance(70);
    expect(budget.remaining('operation')).toBe(0);
    expect(budget.remaining('diagnostics')).toBe(10);
    expect(budget.remaining('trace-flush')).toBe(20);
    expect(budget.remaining('teardown')).toBe(30);
  });

  it('keeps concurrent attempt clocks independent', () => {
    const a = clock(10);
    const b = clock(1_000);
    const first = new TestBudget(100, reserves, a.now);
    const second = new TestBudget(100, reserves, b.now);
    a.advance(65);
    b.advance(5);
    expect(first.operationTimeout(50)).toBe(5);
    expect(second.operationTimeout(50)).toBe(50);
  });

  it('reports the exhausted phase, elapsed total and reserves', () => {
    const time = clock();
    const budget = new TestBudget(100, reserves, time.now);
    time.advance(71);
    let failure: unknown;
    try {
      budget.operationTimeout(20, 'assertion');
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AttemptBudgetExceededError);
    expect(failure).toMatchObject({
      code: 'TW_ATTEMPT_BUDGET_EXCEEDED',
      phase: 'assertion',
      elapsedMs: 71,
      totalMs: 100,
      reserves,
    });
    expect((failure as Error).message).toContain('diagnostics:10,trace:10,teardown:10');
  });

  it('allows a zero-time one-shot check while budget remains', () => {
    const time = clock();
    const budget = new TestBudget(100, reserves, time.now);
    expect(budget.operationTimeout(0, 'assertion')).toBe(0);
  });

  it('does not spend authored-test time while host resource admission is pending', () => {
    const time = clock();
    const budget = new TestBudget(100, reserves, time.now, true);

    time.advance(5_000);
    expect(() => budget.operationTimeout(1)).toThrow(
      'attempt budget has not started; resource admission is still pending',
    );

    budget.start();
    expect(budget.operationTimeout(70)).toBe(70);
    time.advance(70);
    expect(() => budget.operationTimeout(1)).toThrow(AttemptBudgetExceededError);
    expect(() => budget.start()).toThrow('attempt budget has already started');
  });
});
