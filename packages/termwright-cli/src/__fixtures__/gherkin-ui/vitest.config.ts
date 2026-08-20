import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/termwright-cli/src/__fixtures__/gherkin-ui/permission.test.ts',
      'packages/termwright-cli/src/__fixtures__/gherkin-ui/foreign.test.ts',
    ],
  },
});
