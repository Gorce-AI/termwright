import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__fixtures__/native-host.fixture.ts'],
    pool: 'forks',
    maxWorkers: 2,
    fileParallelism: true,
  },
});
