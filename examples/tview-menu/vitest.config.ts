import { defineConfig } from 'vitest/config';
import type { Reporter } from 'vitest/node';
// The reporter comes from the subpath: this file is loaded before the test
// runner exists, and the package root registers matchers on `expect`.
import TermwrightReporter from '@termwright/test/reporter';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The cast is a workaround, not a pattern to copy: the reporter's own
    // declarations do not line up with Vitest's under
    // `exactOptionalPropertyTypes`. Drop it once that is fixed upstream.
    reporters: ['default', new TermwrightReporter() as Reporter],
  },
});
