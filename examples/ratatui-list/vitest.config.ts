import {defineConfig} from 'vitest/config';
import TermwrightReporter from 'termwright/reporter';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['default', new TermwrightReporter()],
  },
});
