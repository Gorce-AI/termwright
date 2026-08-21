import { defineConfig } from 'vitest/config';

// The root runner covers packages/*; examples and website ship their own
// configs/runners (examples need per-package vitest.setup.ts to be loaded).
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'examples/**',
      'website/**',
      // These are subprocess inputs for the UI-host contract. Collecting them
      // in the package suite would execute a deliberate `test.only` foreign
      // case outside the isolated host it is meant to challenge.
      '**/__fixtures__/**',
    ],
  },
});
