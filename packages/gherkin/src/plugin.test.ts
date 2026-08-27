import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SourceMapConsumer, type RawSourceMap } from 'source-map-js';
import { describe, expect, test, vi } from 'vitest';
import type { ResolvedConfig } from 'vite';
import {
  featureIncludesForVitest,
  gherkinPlugin,
  resolvePairing,
  transformFeature,
} from './plugin.js';

const here = dirname(fileURLToPath(import.meta.url));
const pairingRoot = resolve(here, '__fixtures__/pairing/features');
const pairingFeature = resolve(pairingRoot, 'orders/create.feature');
const relativeFixturePath = (path: string): string =>
  relative(pairingRoot, path).split(sep).join('/');

interface ConsumerFixtures {
  readonly account: { readonly name: string };
}

// Consumer type regression: the unparameterized API remains ergonomic, while
// an explicit fixture surface makes misspelled generated bindings a compile
// error instead of an unknown-fixture failure in a transformed worker.
gherkinPlugin({ fixtureNames: ['projectFixture'] });
gherkinPlugin<ConsumerFixtures>({ fixtureNames: ['account'] });
// @ts-expect-error `accout` is not a key of ConsumerFixtures.
gherkinPlugin<ConsumerFixtures>({ fixtureNames: ['accout'] });
// @ts-expect-error native/context fixtures are supplied by the generated bridge.
gherkinPlugin<ConsumerFixtures & { readonly terminal: string }>({ fixtureNames: ['terminal'] });

describe('resolvePairing', () => {
  test('expands filepath then filepart nearest-to-root then global', async () => {
    const result = await resolvePairing({
      featureFile: pairingFeature,
      featureRoot: pairingRoot,
      stepDefinitions: [
        '[filepath].{ts,tsx}',
        '[filepart]/step_definitions/*.{ts,tsx}',
        'global_steps/*.{ts,tsx}',
      ],
    });

    expect(
      result.map(({ path, tier, scope }) => ({
        path: relativeFixturePath(path),
        tier,
        scope,
      })),
    ).toEqual([
      { path: 'orders/create.ts', tier: 0, scope: 'filepath' },
      { path: 'orders/create/step_definitions/local.ts', tier: 1, scope: 'filepart' },
      { path: 'orders/step_definitions/parent.ts', tier: 2, scope: 'filepart' },
      { path: 'step_definitions/root.ts', tier: 3, scope: 'filepart' },
      { path: 'global_steps/global.ts', tier: 4, scope: 'global' },
    ]);
  });

  test('deduplicates overlapping templates at the nearest tier and sorts paths', async () => {
    const result = await resolvePairing({
      featureFile: pairingFeature,
      featureRoot: pairingRoot,
      stepDefinitions: ['[filepath].{ts,more.ts}', '[filepath].ts'],
    });

    expect(result.map(({ path, tier }) => ({ path: relativeFixturePath(path), tier }))).toEqual([
      { path: 'orders/create.more.ts', tier: 0 },
      { path: 'orders/create.ts', tier: 0 },
    ]);
  });
});

describe('transformFeature', () => {
  const source = `Feature: arithmetic

  Background:
    Given a starting value of 2

  Scenario Outline: adds examples
    When I add <amount>
    Then the result is <total>

    Examples:
      | amount | total |
      | 3      | 5     |
      | 4      | 6     |
`;

  test('emits one native test per Outline row and maps it to the physical Scenario line', () => {
    const result = transformFeature({ source, uri: '/tmp/arithmetic.feature', glue: [] });
    const generatedLines = result.code.split('\n');
    const testLines = generatedLines
      .map((line, index) =>
        line.startsWith('test("adds examples [example ') ? index + 1 : undefined,
      )
      .filter((line): line is number => line !== undefined);
    const stepLines = generatedLines
      .map((line, index) => (line.startsWith('await __runStep') ? index + 1 : undefined))
      .filter((line): line is number => line !== undefined);
    const consumer = new SourceMapConsumer(result.map as unknown as RawSourceMap);

    expect(testLines).toHaveLength(2);
    expect(result.code).toContain('test("adds examples [example 1]"');
    expect(result.code).toContain('test("adds examples [example 2]"');
    expect(result.scenarioLines).toEqual([6, 6]);
    expect(testLines.map((line) => consumer.originalPositionFor({ line, column: 0 }).line)).toEqual(
      [6, 6],
    );
    expect(stepLines.map((line) => consumer.originalPositionFor({ line, column: 0 }).line)).toEqual(
      [4, 7, 8, 4, 7, 8],
    );
    expect(result.code).toContain('"keyword":"Given"');
    expect(result.code.match(/"background":true/g)).toHaveLength(2);
    expect(result.code).toContain('"kind":"gherkin-outline-example"');
    expect(result.code).toContain('"ancestors":[{"kind":"feature","title":"arithmetic"}]');
  });

  test('maps Rule Background and Scenario Outline rows to their physical lines', () => {
    const ruleSource = `Feature: rules

  Rule: grouped behavior
    Background:
      Given a rule value

    Scenario Outline: rule examples
      When I use <value>
      Then it works

      Examples:
        | value |
        | one   |
`;
    const result = transformFeature({ source: ruleSource, uri: '/tmp/rules.feature', glue: [] });
    const generatedLines = result.code.split('\n');
    const testLine =
      generatedLines.findIndex((line) => line.startsWith('test("rule examples [example 1]"')) + 1;
    const stepLines = generatedLines
      .map((line, index) => (line.startsWith('await __runStep') ? index + 1 : undefined))
      .filter((line): line is number => line !== undefined);
    const consumer = new SourceMapConsumer(result.map as unknown as RawSourceMap);

    expect(result.scenarioLines).toEqual([7]);
    expect(consumer.originalPositionFor({ line: testLine, column: 0 }).line).toBe(7);
    expect(stepLines.map((line) => consumer.originalPositionFor({ line, column: 0 }).line)).toEqual(
      [5, 8, 9],
    );
    expect(result.code).toContain(
      '"ancestors":[{"kind":"feature","title":"rules"},{"kind":"rule","title":"grouped behavior"}]',
    );
  });

  test('gives duplicate Scenario titles distinct physical targets', () => {
    const result = transformFeature({
      source: `Feature: duplicate titles

  Scenario: same
    Given first

  Scenario: same
    Given second
`,
      uri: '/tmp/duplicates.feature',
      glue: [],
    });

    expect(result.code).toContain('test("same [line 3]"');
    expect(result.code).toContain('test("same [line 6]"');
  });

  test('can keep generated imports on an umbrella package under strict installers', () => {
    const result = transformFeature({
      source: 'Feature: packaged\n\n  Scenario: imports\n    Given a value\n',
      uri: '/tmp/packaged.feature',
      glue: [],
      generatedImports: {
        test: 'termwright/test',
        runtime: 'termwright/gherkin/runtime',
      },
    });

    expect(result.code).toContain('from "termwright/test"');
    expect(result.code).toContain('from "termwright/gherkin/runtime"');
    expect(result.code).not.toContain("from '@termwright/");
  });

  test('requests and forwards named custom fixtures from the generated test module', () => {
    const result = transformFeature({
      source: 'Feature: fixtures\n\n  Scenario: receives one\n    Given an app\n',
      uri: '/tmp/fixtures.feature',
      glue: [],
      fixtureNames: ['app', 'account'],
      generatedImports: {
        test: './fixtures.js',
        runtime: '@termwright/gherkin/runtime',
      },
    });

    expect(result.code).toContain('from "./fixtures.js"');
    expect(result.code).toContain(
      'async ({ termwrightOptions, termwright, terminal, step, app, account }) =>',
    );
    expect(result.code).toContain(
      '{ termwrightOptions, termwright, terminal, step, app, account, expect, world: {}, scenario:',
    );
  });

  test.each([
    { fixtureNames: ['not-valid!'], message: 'JavaScript identifier' },
    { fixtureNames: ['world'], message: 'reserved' },
    { fixtureNames: ['__private'], message: 'reserved' },
    { fixtureNames: ['class'], message: 'reserved' },
    { fixtureNames: ['await'], message: 'reserved' },
    { fixtureNames: ['eval'], message: 'reserved' },
    { fixtureNames: ['arguments'], message: 'reserved' },
    { fixtureNames: ['app', 'app'], message: 'Duplicate' },
  ])('rejects unsafe generated fixture bindings: $fixtureNames', ({ fixtureNames, message }) => {
    expect(() =>
      transformFeature({
        source: 'Feature: fixtures\n\n  Scenario: invalid\n    Given a value\n',
        uri: '/tmp/invalid-fixtures.feature',
        glue: [],
        fixtureNames,
      }),
    ).toThrow(message);
  });

  test('filters native cases with Cucumber tag expressions', () => {
    const result = transformFeature({
      source: `@component
Feature: tagged

  @smoke
  Scenario: selected
    Given a value

  @slow
  Scenario: excluded
    Given another value
`,
      uri: '/tmp/tagged.feature',
      glue: [],
      tags: '@component and @smoke and not @slow',
    });

    expect(result.code).toContain('test("selected"');
    expect(result.code).not.toContain('test("excluded"');
    expect(result.scenarioLines).toEqual([5]);
  });

  test('reports invalid tag expressions during collection', () => {
    expect(() =>
      transformFeature({
        source: 'Feature: tagged\n\n  Scenario: selected\n    Given a value\n',
        uri: '/tmp/tagged.feature',
        glue: [],
        tags: '@smoke and',
      }),
    ).toThrow(/Expected operand/u);
  });
});

describe('gherkinPlugin', () => {
  test('managed discovery projects features onto the resolved Vitest source scope', () => {
    const plugin = gherkinPlugin({ includeFeatures: true });
    const resolved =
      typeof plugin.configResolved === 'function'
        ? plugin.configResolved
        : plugin.configResolved?.handler;
    const config = {
      root: pairingRoot,
      test: { include: ['custom/**/*.test.ts'] },
    } as unknown as ResolvedConfig & { test: { include: string[] } };
    (resolved as undefined | ((config: ResolvedConfig) => void))?.(config);

    expect(config.test.include).toEqual(['custom/**/*.test.ts', 'custom/**/*.feature']);
  });

  test('never widens exact files or nested include globs to the project root', () => {
    expect(
      featureIncludesForVitest([
        'packages/app/src/permission.test.ts',
        'packages/app/src/**/*.spec.ts',
        'packages/other/{unit,integration}/*.test.ts',
        'packages/app/src/auth.feature',
        '!packages/app/src/ignored.test.ts',
      ]),
    ).toEqual([
      'packages/app/src/*.feature',
      'packages/app/src/**/*.feature',
      'packages/other/{unit,integration}/*.feature',
    ]);
  });

  test('registers every paired glue file as a watch dependency', async () => {
    const plugin = gherkinPlugin({
      featureRoot: pairingRoot,
      stepDefinitions: ['[filepath].{ts,tsx}', '[filepart]/step_definitions/*.{ts,tsx}'],
    });
    const resolved =
      typeof plugin.configResolved === 'function'
        ? plugin.configResolved
        : plugin.configResolved?.handler;
    (resolved as undefined | ((config: ResolvedConfig) => void))?.({
      root: pairingRoot,
    } as ResolvedConfig);
    const transform =
      typeof plugin.transform === 'function' ? plugin.transform : plugin.transform?.handler;
    const addWatchFile = vi.fn();
    const source = await readFile(pairingFeature, 'utf8');

    const transformed = await (
      transform as unknown as
        | undefined
        | ((
            this: { addWatchFile(path: string): void },
            source: string,
            id: string,
          ) => Promise<{ code: string } | null>)
    )?.call({ addWatchFile }, source, pairingFeature);

    expect(transformed?.code).toContain('@termwright/gherkin transformed');
    await expect(
      (
        transform as unknown as
          | undefined
          | ((
              this: { addWatchFile(path: string): void },
              source: string,
              id: string,
            ) => Promise<unknown>)
      )?.call({ addWatchFile }, transformed?.code ?? '', pairingFeature),
    ).resolves.toBeNull();

    expect(addWatchFile.mock.calls.map(([path]) => path)).toEqual([
      pairingRoot,
      resolve(pairingRoot, 'orders/create.ts'),
      resolve(pairingRoot, 'orders/create/step_definitions/local.ts'),
      resolve(pairingRoot, 'orders/step_definitions/parent.ts'),
      resolve(pairingRoot, 'step_definitions/root.ts'),
    ]);

    const handleHotUpdate =
      typeof plugin.handleHotUpdate === 'function'
        ? plugin.handleHotUpdate
        : plugin.handleHotUpdate?.handler;
    const featureModule = { id: pairingFeature };
    const glueModule = { id: resolve(pairingRoot, 'orders/create.ts') };
    const affected = await (
      handleHotUpdate as unknown as undefined | ((context: unknown) => unknown)
    )?.({
      file: glueModule.id,
      modules: [glueModule],
      server: { moduleGraph: { getModuleById: () => featureModule } },
    });

    expect(affected).toEqual([glueModule, featureModule]);
  });

  test('invalidates a feature when a new nearer glue file appears', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'termwright-gherkin-'));
    try {
      const feature = resolve(directory, 'addition.feature');
      const newGlue = resolve(directory, 'addition.steps.ts');
      const source = 'Feature: addition\n\n  Scenario: adds\n    Given numbers\n';
      await writeFile(feature, source);
      const plugin = gherkinPlugin({
        featureRoot: directory,
        stepDefinitions: ['[filepath].steps.ts'],
      });
      const resolved =
        typeof plugin.configResolved === 'function'
          ? plugin.configResolved
          : plugin.configResolved?.handler;
      (resolved as undefined | ((config: ResolvedConfig) => void))?.({
        root: directory,
      } as ResolvedConfig);
      const transform =
        typeof plugin.transform === 'function' ? plugin.transform : plugin.transform?.handler;
      await (
        transform as unknown as
          | undefined
          | ((
              this: { addWatchFile(path: string): void },
              source: string,
              id: string,
            ) => Promise<unknown>)
      )?.call({ addWatchFile: vi.fn() }, source, feature);
      await writeFile(newGlue, 'export default [];\n');

      const handleHotUpdate =
        typeof plugin.handleHotUpdate === 'function'
          ? plugin.handleHotUpdate
          : plugin.handleHotUpdate?.handler;
      const featureModule = { id: feature };
      const glueModule = { id: newGlue };
      const affected = await (
        handleHotUpdate as unknown as undefined | ((context: unknown) => unknown)
      )?.({
        file: newGlue,
        modules: [glueModule],
        server: { moduleGraph: { getModuleById: () => featureModule } },
      });

      expect(affected).toEqual([glueModule, featureModule]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('invalidates a feature when paired glue is deleted', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'termwright-gherkin-'));
    try {
      const feature = resolve(directory, 'deletion.feature');
      const glue = resolve(directory, 'deletion.steps.ts');
      const source = 'Feature: deletion\n\n  Scenario: deletes\n    Given glue\n';
      await writeFile(feature, source);
      await writeFile(glue, 'export default [];\n');
      const plugin = gherkinPlugin({
        featureRoot: directory,
        stepDefinitions: ['[filepath].steps.ts'],
      });
      const resolved =
        typeof plugin.configResolved === 'function'
          ? plugin.configResolved
          : plugin.configResolved?.handler;
      (resolved as undefined | ((config: ResolvedConfig) => void))?.({
        root: directory,
      } as ResolvedConfig);
      const transform =
        typeof plugin.transform === 'function' ? plugin.transform : plugin.transform?.handler;
      await (
        transform as unknown as
          | undefined
          | ((
              this: { addWatchFile(path: string): void },
              source: string,
              id: string,
            ) => Promise<unknown>)
      )?.call({ addWatchFile: vi.fn() }, source, feature);
      await rm(glue);

      const handleHotUpdate =
        typeof plugin.handleHotUpdate === 'function'
          ? plugin.handleHotUpdate
          : plugin.handleHotUpdate?.handler;
      const featureModule = { id: feature };
      const affected = await (
        handleHotUpdate as unknown as undefined | ((context: unknown) => unknown)
      )?.({
        file: glue,
        modules: [],
        server: { moduleGraph: { getModuleById: () => featureModule } },
      });

      expect(affected).toEqual([featureModule]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('invalidates a feature when paired glue is renamed', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'termwright-gherkin-'));
    try {
      const feature = resolve(directory, 'rename.feature');
      const oldGlue = resolve(directory, 'rename.old.ts');
      const newGlue = resolve(directory, 'rename.new.ts');
      const source = 'Feature: rename\n\n  Scenario: renames\n    Given glue\n';
      await writeFile(feature, source);
      await writeFile(oldGlue, 'export default [];\n');
      const plugin = gherkinPlugin({
        featureRoot: directory,
        stepDefinitions: ['[filepath].old.ts', '[filepath].new.ts'],
      });
      const resolved =
        typeof plugin.configResolved === 'function'
          ? plugin.configResolved
          : plugin.configResolved?.handler;
      (resolved as undefined | ((config: ResolvedConfig) => void))?.({
        root: directory,
      } as ResolvedConfig);
      const transform =
        typeof plugin.transform === 'function' ? plugin.transform : plugin.transform?.handler;
      await (
        transform as unknown as
          | undefined
          | ((
              this: { addWatchFile(path: string): void },
              source: string,
              id: string,
            ) => Promise<unknown>)
      )?.call({ addWatchFile: vi.fn() }, source, feature);
      await rename(oldGlue, newGlue);

      const handleHotUpdate =
        typeof plugin.handleHotUpdate === 'function'
          ? plugin.handleHotUpdate
          : plugin.handleHotUpdate?.handler;
      const featureModule = { id: feature };
      const affected = await (
        handleHotUpdate as unknown as undefined | ((context: unknown) => unknown)
      )?.({
        file: oldGlue,
        modules: [],
        server: { moduleGraph: { getModuleById: () => featureModule } },
      });

      expect(affected).toEqual([featureModule]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
