import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/test/src/__fixtures__/ui-provider-mixed.fixture.ts'],
    environment: 'node',
  },
});
