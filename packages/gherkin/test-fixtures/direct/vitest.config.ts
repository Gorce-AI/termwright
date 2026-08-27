import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { gherkinPlugin } from '../../src/index.js';
import type { ProjectFixtures } from './fixtures.js';
import ProviderReporter from './provider-reporter.js';

export default defineConfig({
  root: resolve(import.meta.dirname, '../../../..'),
  plugins: [
    gherkinPlugin<ProjectFixtures>({
      featureRoot: 'packages/gherkin/test-fixtures/direct/features',
      stepDefinitions: ['[filepath].steps.{ts,tsx,mts}'],
      fixtureNames: ['projectFixture'],
      generatedImports: {
        test: resolve(import.meta.dirname, 'fixtures.ts'),
        runtime: '@termwright/gherkin/runtime',
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@termwright/gherkin/runtime',
        replacement: resolve(import.meta.dirname, '../../src/runtime.ts'),
      },
      {
        find: /^@termwright\/gherkin$/,
        replacement: resolve(import.meta.dirname, '../../src/index.ts'),
      },
      {
        find: '@termwright/test',
        replacement: resolve(import.meta.dirname, '../../../test/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: [
      'packages/gherkin/test-fixtures/direct/ordinary.test.ts',
      'packages/gherkin/test-fixtures/direct/features/**/*.feature',
    ],
    reporters: ['default', new ProviderReporter()],
  },
});
