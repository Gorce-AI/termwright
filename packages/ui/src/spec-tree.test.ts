import { describe, expect, it } from 'vitest';
import { buildSpecTree, relativeTime, type SpecDirectory, type SpecFile } from './spec-tree.js';
import type { TestRow } from './test-model.js';

const test = (id: string, file: string): TestRow => ({ id, title: id, file, status: 'passed' });

/** Names of a level, so a tree reads as a list in the assertions. */
const names = (nodes: readonly { name: string }[]): string[] => nodes.map((node) => node.name);

describe('grouping specs by directory', () => {
  it('nests files under the folders they live in', () => {
    const tree = buildSpecTree([
      test('a', '/repo/src/login.test.ts'),
      test('b', '/repo/src/checkout/pay.test.ts'),
      test('c', '/repo/src/checkout/cart.test.ts'),
    ]);

    // The chain `repo → src` holds one child each, so it reads as one row.
    expect(names(tree)).toEqual(['repo/src']);
    const src = tree[0] as SpecDirectory;
    expect(names(src.children)).toEqual(['checkout', 'login.test.ts']);
    expect(src.testCount).toBe(3);
  });

  it('counts every test below a folder, at any depth', () => {
    const tree = buildSpecTree([
      test('a', 'src/a/one.test.ts'),
      test('b', 'src/a/deep/two.test.ts'),
      test('c', 'src/a/deep/three.test.ts'),
    ]);
    expect((tree[0] as SpecDirectory).testCount).toBe(3);
  });

  it('keeps several tests of one file together', () => {
    const tree = buildSpecTree([test('a', 'x/login.test.ts'), test('b', 'x/login.test.ts')]);
    const file = (tree[0] as SpecDirectory).children[0] as SpecFile;
    expect(file.tests).toHaveLength(2);
  });

  it('attaches what the history knows about a file', () => {
    const facts = new Map([
      ['x/login.test.ts', { file: 'x/login.test.ts', modifiedMs: 10, averageMs: 500, latest: [] }],
    ]);
    const tree = buildSpecTree([test('a', 'x/login.test.ts')], facts);
    const file = (tree[0] as SpecDirectory).children[0] as SpecFile;
    expect(file.facts?.averageMs).toBe(500);
  });

  it('puts a test whose producer reported no file somewhere findable', () => {
    // Dropping it would hide a test; inventing a path would lie about it.
    const tree = buildSpecTree([{ id: 'a', title: 'orphan', status: 'passed' }]);
    expect(tree).toHaveLength(1);
    expect((tree[0] as SpecFile).kind).toBe('file');
  });
});

describe('paths inside and outside the project', () => {
  it('reads a spec by where it is in the project, not by where the disk is', () => {
    const tree = buildSpecTree(
      [test('a', '/home/me/proj/src/login.test.ts')],
      new Map(),
      '/home/me/proj',
    );
    expect(names(tree)).toEqual(['src']);
  });

  it('keeps the full path of a spec that is not under the project', () => {
    // A linked package or a generated file: shortening it would place it in a
    // folder it is not in.
    const tree = buildSpecTree([test('a', '/elsewhere/pkg/x.test.ts')], new Map(), '/home/me/proj');
    expect(names(tree)).toEqual(['elsewhere/pkg']);
  });
});

describe('how long ago', () => {
  const now = Date.parse('2026-08-16T12:00:00Z');
  it('says it the way a person would', () => {
    expect(relativeTime(now - 30_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
    expect(relativeTime(now - 400 * 86_400_000, now)).toBe('1 year ago');
  });

  it('does not report the future as a negative age', () => {
    // Clock skew between a CI writer and a reader is normal.
    expect(relativeTime(now + 60_000, now)).toBe('just now');
  });
});
