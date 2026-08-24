import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const termwrightRunner = fileURLToPath(new URL('./packages/test/dist/runner.js', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('.', import.meta.url));

const configuredPackages = [
  'conformance',
  'gherkin',
  'ink',
  'mcp',
  'probe-ink',
  'screenshot',
  'test',
  'trace',
  'ui',
] as const;

const configuredExamples = [
  'bubbletea-login',
  'getting-started',
  'ink-todo',
  'opentui-form',
  'ratatui-list',
  'textual-notes',
  'tview-menu',
] as const;

// One Vitest engine owns the monorepo run, while projects preserve the actual
// package contracts (timeouts, setup, aliases and file serialization). A root
// catch-all project covers packages that need no special configuration plus
// repository-level architectural tests. This is deliberately not package
// process fan-out: the Termwright host still owns one RunId and one broker.
export default defineConfig({
  test: {
    // Repository certification is always single-attempt. Explicit --retry is
    // reserved for local diagnosis and still produces a non-certifying flaky
    // result when a later attempt passes.
    retry: 0,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'packages/protocol/src/**/*.ts',
        'packages/vt/src/**/*.ts',
        'packages/recognizers/src/**/*.ts',
        'packages/evidence-provider/src/**/*.ts',
      ],
    },
    projects: [
      {
        root: repositoryRoot,
        test: {
          name: 'core',
          runner: termwrightRunner,
          include: [
            'packages/**/*.test.ts',
            'compatibility/**/*.test.ts',
            'scripts/**/*.test.mjs',
          ],
          exclude: [
            '**/__fixtures__/**',
            '**/node_modules/**',
            '**/dist/**',
            ...configuredPackages.map((name) => `packages/${name}/**`),
          ],
        },
      },
      ...configuredPackages.map((name) => ({
        extends: fileURLToPath(new URL(`./packages/${name}/vitest.config.ts`, import.meta.url)),
        root: fileURLToPath(new URL(`./packages/${name}/`, import.meta.url)),
        test: { name, runner: termwrightRunner },
      })),
      ...configuredExamples.map((name) => ({
        extends: fileURLToPath(new URL(`./examples/${name}/vitest.config.ts`, import.meta.url)),
        root: fileURLToPath(new URL(`./examples/${name}/`, import.meta.url)),
        test: { name: `example-${name}`, runner: termwrightRunner },
      })),
    ],
  },
});
