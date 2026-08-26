import { describe, expect, it } from 'vitest';
import { literalLeafTitles, literalPlatformSkips, validateExactSkipReferences } from './check-platform-deviations.mjs';

const registry = (file, title) => ({
  version: 1,
  deviations: [{ id: 'platform-rule', tests: [], skipPolicyTests: [[file, title]] }],
});

describe('exact native skip-policy references', () => {
  it('accepts exactly one literal leaf in the declared file', () => {
    expect(() => validateExactSkipReferences(
      registry('exact.test.ts', 'leaf case'),
      undefined,
      new Map([['exact.test.ts', "describe('suite', () => { it('leaf case', () => {}); });"]]),
    )).not.toThrow();
  });

  it('rejects missing, duplicate and cross-file leaf references', () => {
    expect(() => validateExactSkipReferences(
      registry('exact.test.ts', 'missing'),
      undefined,
      new Map([['exact.test.ts', "it('present', () => {});"]]),
    )).toThrow(/does not match a literal leaf test/u);

    expect(() => validateExactSkipReferences(
      registry('exact.test.ts', 'duplicate'),
      undefined,
      new Map([['exact.test.ts', "it('duplicate', () => {}); test.only('duplicate', () => {});"]]),
    )).toThrow(/matches 2 literal leaf tests/u);

    expect(() => validateExactSkipReferences(
      registry('wrong.test.ts', 'moved'),
      undefined,
      new Map([
        ['wrong.test.ts', "it('different', () => {});"],
        ['actual.test.ts', "test('moved', () => {});"],
      ]),
    )).toThrow(/exists only in actual\.test\.ts/u);
  });

  it('validates required applicability leaves but permits optional generated suites', () => {
    const applicability = { version: 1, rules: [
      { id: 'required', file: 'required.test.ts', fullName: 'required leaf', required: true },
      { id: 'generated', file: 'factory-caller.test.ts', fullName: 'factory leaf', required: false },
    ] };
    expect(() => validateExactSkipReferences(
      { version: 1, deviations: [] },
      applicability,
      new Map([['required.test.ts', "test('required leaf', () => {});"]]),
    )).not.toThrow();
    expect(() => validateExactSkipReferences(
      { version: 1, deviations: [] },
      applicability,
      new Map([['required.test.ts', "test('different leaf', () => {});"]]),
    )).toThrow(/required.*does not match a literal leaf test/u);
  });

  it('treats null skip-policy cases as an absent exact override', () => {
    expect(() => validateExactSkipReferences(
      { version: 1, deviations: [{ id: 'suite-only', tests: [], skipPolicyTests: null }] },
      undefined,
      new Map(),
    )).not.toThrow();
  });

  it('extracts leaf literals without mistaking suites or computed titles for leaves', () => {
    expect(literalLeafTitles(`
      describe('suite', () => {});
      it('plain', () => {});
      test.only("quoted", () => {});
      it.skipIf(process.platform === 'win32')('conditional', () => {});
      test.concurrent.for([1])('parameterized', () => {});
      test(dynamicTitle, () => {});
      // it('comment-only', () => {});
    `)).toEqual(['plain', 'quoted', 'conditional', 'parameterized']);
  });

  it('recognizes resource-aware imports and configured declaration aliases', () => {
    expect(literalLeafTitles(`
      import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
      const nativePressureIt = resourceAwareIt.resources({ terminals: 1, nativeHost: 'exclusive' });
      nativePressureIt('pressure case', () => {});
      resourceAwareIt.resources({ terminals: 2 })('group case', () => {});
    `)).toEqual(['pressure case', 'group case']);
  });

  it('finds platform skips through a resource-aware declaration chain', () => {
    const source = `
      import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
      resourceAwareIt.resources({ terminals: 4 }).skipIf(process.platform !== 'win32')(
        'Windows ownership',
        () => {},
      );
      describe.skipIf(process.platform === 'win32')('POSIX ownership', () => {});
    `;
    expect(literalPlatformSkips(source)).toEqual([
      { title: 'Windows ownership', condition: "process.platform !== 'win32'" },
      { title: 'POSIX ownership', condition: "process.platform === 'win32'" },
    ]);
    expect(literalLeafTitles(source)).toEqual(['Windows ownership']);
  });
});
