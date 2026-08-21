import { defineTermwrightConfig, XTERM_PALETTE } from 'termwright/test';

export default defineTermwrightConfig({
  columns: 72,
  rows: 20,
  // No default command: the test resolves the interpreter it found, so a
  // machine with only `python` still runs the suite.
  trace: 'retain-on-failure',
  outputDir: 'termwright-report',
  timeouts: { expect: 5_000, action: 5_000 },
  profiles: {
    ci: { trace: 'on', palette: XTERM_PALETTE },
  },
});
