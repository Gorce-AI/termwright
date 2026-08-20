/**
 * Child-process host for Vitest runs owned by `termwright ui`.
 *
 * Vitest 3.2 supports a custom runner in its Node API and config, but not as a
 * CLI flag. This host mirrors the small public CLI lifecycle while forcing the
 * fail-closed UI runner after parsing the user's normal Vitest arguments.
 */

import { createRequire } from 'node:module';
import { hasTermwrightProvider } from '@termwright/ui';
import { createVitest, parseCLI, startVitest } from 'vitest/node';
import { uiVitestViteOverrides } from './ui-vitest-config.js';

const mode = process.argv[2] === 'watch' ? 'watch' : process.argv[2] === 'list' ? 'list' : 'run';
const args = process.argv.slice(3);
const UI_LOCATION_FILTER_ENV = 'TERMWRIGHT_UI_LOCATION_FILTER';

try {
  const parsed = parseCLI(['vitest', mode, ...args], { allowUnknownOptions: true });
  process.env[UI_LOCATION_FILTER_ENV] = parsed.filter.some((filter) => /:\d+$/u.test(filter)) ? '1' : '0';
  const runner = createRequire(import.meta.url).resolve('@termwright/test/ui-runner');
  if (mode === 'list') {
    const vitest = await createVitest(
      'test',
      {
        ...parsed.options,
        watch: false,
        run: true,
        allowOnly: true,
        includeTaskLocation: true,
        runner,
      },
      uiVitestViteOverrides(),
    );
    try {
      const collected = await vitest.collect(parsed.filter);
      if (collected.unhandledErrors.length > 0) {
        throw new Error('Vitest reported an error while collecting Termwright tests');
      }
      const listing = collected.testModules.flatMap((module) =>
        [...module.children.allTests()]
          .filter((testCase) => hasTermwrightProvider(testCase.meta()))
          .map((testCase) => {
            const metadata = termwrightMetadata(testCase.meta());
            const source = metadata?.source ?? (testCase.location === undefined
              ? undefined
              : { file: testCase.module.moduleId, ...testCase.location });
            return {
              name: testCase.fullName,
              file: source?.file ?? testCase.module.moduleId,
              ...(metadata?.provider === undefined ? {} : { provider: metadata.provider }),
              kind: metadata?.kind ?? 'test',
              ...(metadata?.ancestors === undefined ? {} : { ancestors: metadata.ancestors }),
              ...(metadata?.tags === undefined ? {} : { tags: metadata.tags }),
              ...(source === undefined ? {} : { source }),
            };
          }),
      );
      process.stdout.write(JSON.stringify(listing));
    } finally {
      await vitest.close();
    }
  } else {
    const vitest = await startVitest(
      'test',
      parsed.filter,
      {
        ...parsed.options,
        watch: mode === 'watch',
        run: mode === 'run',
        includeTaskLocation: true,
        // An unmarked `.only` is discarded by the UI runner. Letting Vitest turn
        // it into an allowOnly collection failure first would still poison the
        // provider run it is forbidden to control.
        allowOnly: true,
        runner,
      },
      uiVitestViteOverrides(),
    );
    if (!vitest.shouldKeepServer()) await vitest.exit();
  }
} catch (error) {
  const reason = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`termwright: could not start Vitest\n${reason}\n`);
  process.exitCode = 1;
}

interface TermwrightListingMetadata {
  readonly provider?: { readonly id: string; readonly version: number };
  readonly kind?: 'test' | 'gherkin-scenario' | 'gherkin-outline-example';
  readonly ancestors?: readonly { readonly kind: 'feature' | 'rule'; readonly title: string }[];
  readonly tags?: readonly string[];
  readonly source?: { readonly file: string; readonly line: number; readonly column: number };
}

function termwrightMetadata(meta: unknown): TermwrightListingMetadata | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined;
  const termwright = (meta as Record<string, unknown>)['termwright'];
  if (typeof termwright !== 'object' || termwright === null) return undefined;
  const record = termwright as Record<string, unknown>;
  const provider = listingProvider(record['provider']);
  const kind = listingKind(record['kind']);
  const ancestors = listingAncestors(record['ancestors']);
  const tags = stringList(record['tags']);
  const source = listingSource(record['source']);
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(kind === undefined ? {} : { kind }),
    ...(ancestors === undefined ? {} : { ancestors }),
    ...(tags === undefined ? {} : { tags }),
    ...(source === undefined ? {} : { source }),
  };
}

function listingProvider(value: unknown): { id: string; version: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string' || record['id'] === '') return undefined;
  if (!Number.isInteger(record['version'])) return undefined;
  return { id: record['id'], version: record['version'] as number };
}

function listingKind(value: unknown): TermwrightListingMetadata['kind'] {
  return value === 'test' || value === 'gherkin-scenario' || value === 'gherkin-outline-example'
    ? value
    : undefined;
}

function listingAncestors(value: unknown): TermwrightListingMetadata['ancestors'] {
  if (!Array.isArray(value)) return undefined;
  const ancestors: { kind: 'feature' | 'rule'; title: string }[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return undefined;
    const record = item as Record<string, unknown>;
    const kind = record['kind'];
    if (kind !== 'feature' && kind !== 'rule') return undefined;
    if (typeof record['title'] !== 'string' || record['title'] === '') return undefined;
    ancestors.push({ kind, title: record['title'] });
  }
  return ancestors;
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item !== '')) {
    return undefined;
  }
  return value;
}

function listingSource(value: unknown): TermwrightListingMetadata['source'] {
  const source = value;
  if (typeof source !== 'object' || source === null) return undefined;
  const record = source as Record<string, unknown>;
  if (typeof record['file'] !== 'string' || record['file'] === '') return undefined;
  if (!Number.isInteger(record['line']) || (record['line'] as number) < 1) return undefined;
  if (!Number.isInteger(record['column']) || (record['column'] as number) < 1) return undefined;
  return { file: record['file'], line: record['line'] as number, column: record['column'] as number };
}
