import { defineTermwrightConfig, XTERM_PALETTE } from 'termwright/test';

export default defineTermwrightConfig({
  columns: 60,
  rows: 12,
  trace: 'retain-on-failure',
  outputDir: 'termwright-report',
  timeouts: { expect: 5_000, action: 5_000 },
  profiles: {
    ci: { trace: 'on', palette: XTERM_PALETTE },
  },
});
