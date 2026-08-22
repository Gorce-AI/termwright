/**
 * Native-host discovery. The host supplies Vitest's collected identity and
 * provider metadata as structured data; stdout and file/title synthesis are
 * deliberately not part of the product contract.
 *
 * @packageDocumentation
 */

import { canonicalTestFile } from './test-model.js';

export { canonicalTestFile } from './test-model.js';

export type DiscoveredTestKind = 'test' | 'gherkin-scenario' | 'gherkin-outline-example';

export interface DiscoveredTestSource {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface DiscoveredTestAncestor {
  readonly kind: 'feature' | 'rule';
  readonly title: string;
}

/** One test the project holds. */
export interface DiscoveredTest {
  /** Invocation-scoped canonical RunnerTaskId minted by the native host. */
  readonly id: string;
  /** Full name, as Vitest prints it: `suite > case`. */
  readonly title: string;
  readonly file: string;
  /** Declaration-time provider identity. Never inferred from an import path or title. */
  readonly provider?: { readonly id: string; readonly version: number };
  /** Provider-authored catalogue kind. */
  readonly kind?: DiscoveredTestKind;
  /** Provider-authored hierarchy, outermost first. */
  readonly ancestors?: readonly DiscoveredTestAncestor[];
  readonly tags?: readonly string[];
  /** Physical authoring location, which can differ from the transformed module location. */
  readonly source?: DiscoveredTestSource;
}

/** Options for {@link discoverTests}. */
export interface DiscoveryOptions {
  /** Directory watched for source changes by the UI projection. */
  readonly cwd: string;
  /** Required structured source owned by TermwrightTestHost. */
  readonly load: () => Promise<readonly DiscoveredTest[]>;
}

const MAX_TESTS = 10_000;

/**
 * Lists the project's tests.
 *
 * Collection/configuration failures reject and are surfaced as infrastructure
 * failures. They are never projected as an empty suite.
 *
 * @example
 * ```ts
 * const tests = await discoverTests({ cwd: process.cwd() });
 * tests[0]?.title; // 'the todo app > starts on the list it was seeded with'
 * ```
 */
export async function discoverTests(options: DiscoveryOptions): Promise<readonly DiscoveredTest[]> {
  const tests = await options.load();
  if (tests.length > MAX_TESTS) throw new Error(`native discovery exceeded ${MAX_TESTS} tests`);
  const ids = new Set<string>();
  for (const test of tests) {
    if (test.id === '' || ids.has(test.id)) throw new Error(`native discovery returned duplicate/invalid id ${test.id}`);
    ids.add(test.id);
    if (test.title === '' || test.file === '') throw new Error('native discovery returned an invalid test');
  }
  return Object.freeze(tests.map((test) => Object.freeze({ ...test, file: canonicalTestFile(test.file) })));
}
