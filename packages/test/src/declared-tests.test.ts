import { describe, expect, it } from 'vitest';
import { collectTestNames } from './declared-tests.js';

/** A file task as Vitest collects one, skipped members included. */
const file = {
  type: 'suite',
  name: '/repo/src/login.test.ts',
  tasks: [
    { type: 'test', name: 'runs at the top level' },
    {
      type: 'suite',
      name: 'the preset against a real PTY',
      mode: 'skip',
      tasks: [
        { type: 'test', name: 'starts', mode: 'skip' },
        {
          type: 'suite',
          name: 'nested',
          tasks: [{ type: 'test', name: 'deep', mode: 'skip' }],
        },
      ],
    },
  ],
};

describe('collectTestNames', () => {
  it('joins suites into the full name expect() reports', () => {
    expect([...collectTestNames(file)]).toEqual([
      'runs at the top level',
      'the preset against a real PTY > starts',
      'the preset against a real PTY > nested > deep',
    ]);
  });

  it('counts a skipped test as declared', () => {
    // The whole point: on a machine without a PTY these tests are skipped, and
    // their snapshots must survive.
    expect(collectTestNames(file).has('the preset against a real PTY > starts')).toBe(true);
  });

  it('leaves the file name out of the full name', () => {
    expect([...collectTestNames(file)].some((name) => name.includes('login.test.ts'))).toBe(false);
  });

  it('tolerates an uncollected file', () => {
    expect(collectTestNames({}).size).toBe(0);
    expect(collectTestNames({ tasks: [] }).size).toBe(0);
  });
});
