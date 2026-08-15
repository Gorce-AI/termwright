import { fileURLToPath } from 'node:url';
import { defineTermwrightConfig, XTERM_PALETTE } from '@termwright/test';

/** Absolute: each test runs in its own temporary working directory. */
export const binary = fileURLToPath(new URL('./dist/tview-menu', import.meta.url));

export default defineTermwrightConfig({
  columns: 72,
  rows: 16,
  command: [binary],
  trace: 'retain-on-failure',
  outputDir: 'termwright-report',
  timeouts: { expect: 5_000, action: 5_000 },
  profiles: {
    ci: { trace: 'on', palette: XTERM_PALETTE },
  },
});
