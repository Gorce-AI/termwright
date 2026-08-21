import { defineConfig } from 'vitest/config';

// Process-level instrumentation tests build and execute the package's exact
// published artifacts. Serial files prevent concurrent tsup --clean runs from
// deleting declarations while another fixture is compiling.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
