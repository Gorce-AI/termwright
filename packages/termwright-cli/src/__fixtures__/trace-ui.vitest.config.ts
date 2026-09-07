import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__fixtures__/trace-ui.fixture.ts'],
    pool: 'forks',
    maxWorkers: 1,
  },
});
