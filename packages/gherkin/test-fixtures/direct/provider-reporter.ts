import type { Reporter } from 'vitest/reporters';

type CollectedModule = Parameters<NonNullable<Reporter['onTestModuleCollected']>>[0];

/** Fails the direct fixture if transformed cases lose @termwright/test ownership metadata. */
export default class ProviderReporter implements Reporter {
  #collectedFeatures = 0;

  onTestModuleCollected(module: CollectedModule): void {
    if (!module.moduleId.split('?', 1)[0]?.endsWith('.feature')) return;
    this.#collectedFeatures += 1;
    const tests = [...module.children.allTests()];
    if (tests.length === 0) throw new Error('the physical feature declared no native tests');
    if (new Set(tests.map((test) => test.name)).size !== tests.length) {
      throw new Error('Scenario Outline rows do not have unique native targets');
    }
    for (const test of tests) {
      const meta = test.meta() as {
        readonly termwright?: {
          readonly provider?: { readonly id?: unknown; readonly version?: unknown };
          readonly kind?: unknown;
          readonly source?: { readonly file?: unknown; readonly line?: unknown; readonly column?: unknown };
        };
      };
      const provider = meta.termwright?.provider;
      if (provider?.id !== '@termwright/test' || provider.version !== 1) {
        throw new Error(`feature case ${test.name} is missing the @termwright/test provider marker`);
      }
      const arithmetic = module.moduleId.split('?', 1)[0]?.endsWith('arithmetic.feature') === true;
      const expectedKind = arithmetic ? 'gherkin-outline-example' : 'gherkin-scenario';
      if (meta.termwright?.kind !== expectedKind) {
        throw new Error(`feature case ${test.name} is missing its provider-authored kind`);
      }
      const source = meta.termwright?.source;
      if (
        typeof source?.file !== 'string' ||
        !source.file.endsWith(arithmetic ? 'arithmetic.feature' : 'custom-fixtures.feature') ||
        source.line !== (arithmetic ? 6 : 3) ||
        source.column !== 3
      ) {
        throw new Error(`feature case ${test.name} is missing its physical source`);
      }
    }
  }

  onTestRunEnd(): void {
    if (this.#collectedFeatures === 0) {
      throw new Error('the direct Vitest run collected no physical feature module');
    }
  }
}
