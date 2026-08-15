import { defineConfig } from 'vitest/config';

// The root runner covers packages/*; examples and website ship their own
// configs/runners (examples need per-package vitest.setup.ts to be loaded).
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'examples/**', 'website/**'],
  },
});
