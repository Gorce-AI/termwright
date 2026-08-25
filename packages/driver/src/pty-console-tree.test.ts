import { describe, expect, it } from 'vitest';
import { ownedConsoleTreePids } from './pty.js';

describe('console tree ownership', () => {
  it('excludes the process doing the killing', () => {
    // Enumerating a ConPTY's processes attaches the caller to that console, so
    // the list can name the caller. Acting on it unfiltered kills the test
    // worker, and nothing after that runs to explain why.
    expect(ownedConsoleTreePids([1234, 4321, 1234], 4321)).toEqual([1234]);
  });

  it('drops values that cannot be a process', () => {
    expect(ownedConsoleTreePids([0, -1, 1.5, Number.NaN, 77], 4321)).toEqual([77]);
  });

  it('keeps a real tree intact', () => {
    expect(ownedConsoleTreePids([10, 11, 12], 4321)).toEqual([10, 11, 12]);
  });
});
