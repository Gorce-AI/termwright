import { fileURLToPath } from 'node:url';
import { defineTermwrightConfig, XTERM_PALETTE } from 'termwright/test';
import { withProbe } from '@termwright/probe-ink';

// Each test runs in its own temporary directory, so the command has to be an
// absolute path — a relative one would resolve against that directory.
const cli = fileURLToPath(new URL('./dist/cli.js', import.meta.url));

export default defineTermwrightConfig({
  columns: 72,
  rows: 18,
  command: withProbe('node', [process.execPath, cli]).command,
  trace: 'retain-on-failure',
  outputDir: 'termwright-report',
  timeouts: { expect: 5_000, action: 5_000 },
  profiles: {
    // TERMWRIGHT_PROFILE=ci. Pinning the palette and TERM is what makes cell
    // snapshots taken on a laptop still match the ones CI takes.
    ci: { trace: 'on', palette: XTERM_PALETTE },
  },
});
