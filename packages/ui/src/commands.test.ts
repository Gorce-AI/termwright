import { describe, expect, it } from 'vitest';
import { buildCommandLog, currentCommand, parseRef, stepCommand } from './commands.js';

const log = buildCommandLog([
  { kind: 'step-start', t: 100, castOffset: 90, stepId: 's1', title: 'approve' },
  { kind: 'action', t: 150, castOffset: 140, api: 'locator.click', selector: 'button', ref: 'n8@42', ok: true, stepId: 's1' },
  { kind: 'assert', t: 200, castOffset: 190, api: 'toBeVisible', selector: 'dialog', ok: false, error: 'still hidden', stepId: 's1' },
  { kind: 'step-end', t: 250, castOffset: 240, stepId: 's1', status: 'failed' },
  { kind: 'input', t: 300, castOffset: 290, dataB64: 'DQ==', inputKind: 'key' },
]);

describe('buildCommandLog', () => {
  it('reads steps, actions, assertions and inputs in order', () => {
    expect(log.map((row) => [row.kind, row.label])).toEqual([
      ['step', 'approve'],
      ['action', 'locator.click'],
      ['assert', 'toBeVisible'],
      ['input', 'input (key)'],
    ]);
  });

  it('positions rows on the cast timeline', () => {
    expect(log.map((row) => row.t)).toEqual([90, 140, 190, 290]);
  });

  it('nests what happened inside a step', () => {
    expect(log[0]?.depth).toBe(0);
    expect(log[1]?.depth).toBe(1);
    expect(log[1]?.stepId).toBe('s1');
  });

  it('closes a step with its outcome and end time', () => {
    expect(log[0]?.endT).toBe(240);
    expect(log[0]?.ok).toBe(false);
  });

  it('keeps the selector, ref and failure of each row', () => {
    expect(log[1]?.selector).toBe('button');
    expect(log[1]?.ref).toBe('n8@42');
    expect(log[2]?.ok).toBe(false);
    expect(log[2]?.error).toBe('still hidden');
  });

  it('skips events it cannot read, and keeps the rest', () => {
    const rows = buildCommandLog([
      'not an event',
      { kind: 'action' }, // no api, no time
      { kind: 'action', t: 5, api: 'locator.press', ok: true },
      null,
    ]);
    expect(rows.map((row) => row.label)).toEqual(['locator.press']);
  });

  it('survives a step that never closed', () => {
    const rows = buildCommandLog([
      { kind: 'step-start', t: 0, stepId: 's1', title: 'open' },
      { kind: 'action', t: 10, api: 'locator.click', ok: true },
    ]);
    expect(rows[0]?.endT).toBeUndefined();
    expect(rows[0]?.ok).toBeUndefined();
    expect(rows[1]?.depth).toBe(1);
  });

  it('closes the innermost step when the end names none', () => {
    const rows = buildCommandLog([
      { kind: 'step-start', t: 0, stepId: 'outer', title: 'outer' },
      { kind: 'step-start', t: 10, stepId: 'inner', title: 'inner' },
      { kind: 'step-end', t: 20, status: 'passed' },
      { kind: 'action', t: 30, api: 'locator.click', ok: true },
    ]);
    expect(rows[1]?.endT).toBe(20);
    // step-end closes a row rather than adding one, so the action is rows[2] —
    // and it is still one level in, inside the outer step.
    expect(rows[2]?.label).toBe('locator.click');
    expect(rows[2]?.depth).toBe(1);
  });

  it('bounds a hostile event log', () => {
    const many = Array.from({ length: 10_000 }, (_, index) => ({
      kind: 'action',
      t: index,
      api: 'x'.repeat(10_000),
      ok: true,
    }));
    const rows = buildCommandLog(many);
    expect(rows).toHaveLength(5_000);
    expect(rows[0]?.label.length).toBe(2_048);
  });
});

describe('currentCommand', () => {
  it('is the last row that had started', () => {
    expect(currentCommand(log, 0)).toBe(-1);
    expect(currentCommand(log, 90)).toBe(0);
    expect(currentCommand(log, 189)).toBe(1);
    expect(currentCommand(log, 10_000)).toBe(3);
  });
});

describe('stepCommand', () => {
  it('walks actions and assertions, skipping steps and inputs', () => {
    expect(stepCommand(log, 0, 1)?.label).toBe('locator.click');
    expect(stepCommand(log, 140, 1)?.label).toBe('toBeVisible');
    expect(stepCommand(log, 190, -1)?.label).toBe('locator.click');
  });

  it('returns nothing past the ends', () => {
    expect(stepCommand(log, 10_000, 1)).toBeUndefined();
    expect(stepCommand(log, 0, -1)).toBeUndefined();
  });
});

describe('parseRef', () => {
  it('splits a ref into node and revision', () => {
    expect(parseRef('n8@42')).toEqual({ nodeId: 'n8', revision: 42 });
  });

  it('rejects anything else', () => {
    expect(parseRef('n8')).toBeNull();
    expect(parseRef('cells(1,2)')).toBeNull();
    expect(parseRef('n8@rev')).toBeNull();
  });
});

describe('a row the user picked', () => {
  it('wins the highlight over another row sharing its millisecond', () => {
    const rows = buildCommandLog([
      { kind: 'assert', t: 718, api: 'toHaveState', ok: true },
      { kind: 'step-start', t: 718, stepId: 's1', title: 'open the dialog' },
    ]);
    const assertion = rows.find((row) => row.kind === 'assert');
    expect(currentCommand(rows, 718)).toBe(1); // the step sorted last
    expect(currentCommand(rows, 718, assertion?.id)).toBe(0);
  });

  it('is ignored when the replay has moved past it', () => {
    const rows = buildCommandLog([
      { kind: 'action', t: 100, api: 'locator.click', ok: true },
      { kind: 'action', t: 200, api: 'locator.press', ok: true },
    ]);
    expect(currentCommand(rows, 200, rows[0]?.id)).toBe(1);
  });
});
