import { describe, expect, it } from 'vitest';
import {
  countTests,
  discoveredId,
  parseDiscoveredId,
  describeCounts,
  filterTests,
  groupTests,
  shortenPath,
  testDuration,
  type TestRow,
} from './test-model.js';

const test = (partial: Partial<TestRow> & Pick<TestRow, 'id'>): TestRow => ({
  title: partial.id,
  status: 'passed',
  ...partial,
});

const suite: TestRow[] = [
  test({ id: 't1', title: 'logs in', file: '/repo/tests/auth/login.test.ts', durationMs: 120 }),
  test({ id: 't2', title: 'rejects a bad password', file: '/repo/tests/auth/login.test.ts', status: 'failed' }),
  test({ id: 't3', title: 'renders the menu', file: '/repo/tests/ui/menu.test.ts', flaky: true }),
  test({ id: 't4', title: 'no file reported' }),
];

describe('filterTests', () => {
  it('matches title and file, case-insensitively', () => {
    expect(filterTests(suite, 'PASSWORD').map((row) => row.id)).toEqual(['t2']);
    expect(filterTests(suite, 'auth/').map((row) => row.id)).toEqual(['t1', 't2']);
  });

  it('returns everything for an empty or whitespace query', () => {
    expect(filterTests(suite, '')).toHaveLength(4);
    expect(filterTests(suite, '   ')).toHaveLength(4);
  });

  it('treats the query as text, not a pattern', () => {
    expect(() => filterTests(suite, '(')).not.toThrow();
    expect(filterTests(suite, '(')).toHaveLength(0);
  });
});

describe('groupTests', () => {
  it('groups by file, keeping first-seen order', () => {
    const groups = groupTests(suite);
    expect(groups.map((group) => group.label)).toEqual([
      'auth/login.test.ts',
      'ui/menu.test.ts',
      'no file',
    ]);
    expect(groups[0]?.tests.map((row) => row.id)).toEqual(['t1', 't2']);
  });

  it('keeps the full path for a tooltip while showing a short label', () => {
    expect(groupTests(suite)[0]?.file).toBe('/repo/tests/auth/login.test.ts');
  });
});

describe('countTests', () => {
  it('counts each status, with flaky overlapping passed', () => {
    expect(
      countTests([...suite, test({ id: 't5', status: 'running' }), test({ id: 't6', status: 'not-run' })]),
    ).toEqual({
      total: 6,
      passed: 3,
      failed: 1,
      skipped: 0,
      flaky: 1,
      running: 1,
      notRun: 1,
    });
  });
});

describe('testDuration', () => {
  it('prefers the reported duration', () => {
    expect(testDuration(test({ id: 't1', durationMs: 120, startedAt: 0 }), 10_000)).toBe(120);
  });

  it('measures a running test against the clock', () => {
    expect(testDuration(test({ id: 't1', status: 'running', startedAt: 1_000 }), 3_500)).toBe(2_500);
  });

  it('never goes negative when the clocks disagree', () => {
    expect(testDuration(test({ id: 't1', status: 'running', startedAt: 5_000 }), 1_000)).toBe(0);
  });

  it('shows nothing for a test that has never run', () => {
    expect(testDuration(test({ id: 't1', status: 'not-run' }), 1_000)).toBeNull();
  });

  it('shows nothing rather than a made-up zero', () => {
    expect(testDuration(test({ id: 't1', status: 'running' }), 1_000)).toBeNull();
    expect(testDuration(test({ id: 't1', status: 'passed' }), 1_000)).toBeNull();
  });
});

describe('shortenPath', () => {
  it('keeps the last two segments, on either separator', () => {
    expect(shortenPath('/repo/tests/auth/login.test.ts')).toBe('auth/login.test.ts');
    expect(shortenPath('C:\\repo\\ui\\menu.test.ts')).toBe('ui/menu.test.ts');
    expect(shortenPath('login.test.ts')).toBe('login.test.ts');
  });
});

describe('describeCounts', () => {
  it('mentions flaky, skipped and running only when they happened', () => {
    expect(describeCounts(countTests(suite))).toBe('4 tests, 3 passed, 1 failed, 1 flaky');
    expect(
      describeCounts({ total: 2, passed: 2, failed: 0, skipped: 0, flaky: 0, running: 0, notRun: 0 }),
    ).toBe('2 tests, 2 passed, 0 failed');
  });
});

describe('discovered ids', () => {
  it('round-trip, including titles that contain colons', () => {
    const id = discoveredId('/repo/a.test.ts', 'parses http://example.com');
    expect(id).toBe('/repo/a.test.ts::parses http://example.com');
    expect(parseDiscoveredId(id)).toEqual({
      file: '/repo/a.test.ts',
      title: 'parses http://example.com',
    });
  });

  it('rejects an id that did not come from discovery', () => {
    expect(parseDiscoveredId('t1')).toBeNull();
    expect(parseDiscoveredId('::orphan')).toBeNull();
    expect(parseDiscoveredId('/repo/a.test.ts::')).toBeNull();
  });
});
