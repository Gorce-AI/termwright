import { fileURLToPath } from 'node:url';
import { defineTermwrightConfig, XTERM_PALETTE } from 'termwright/test';

export const binary = fileURLToPath(new URL('./dist/bubbletea-login', import.meta.url));

export default defineTermwrightConfig({
  columns: 72,
  rows: 14,
  command: [binary],
  trace: 'retain-on-failure',
  outputDir: 'termwright-report',
  timeouts: { expect: 5_000, action: 5_000 },
  profiles: { ci: { trace: 'on', palette: XTERM_PALETTE } },
});
