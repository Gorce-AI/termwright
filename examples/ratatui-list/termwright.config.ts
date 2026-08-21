import {fileURLToPath} from 'node:url';
import {defineTermwrightConfig, XTERM_PALETTE} from 'termwright/test';

const suffix = process.platform === 'win32' ? '.exe' : '';
export const binary = fileURLToPath(new URL(`./app/target/debug/termwright-ratatui-list-example${suffix}`, import.meta.url));

export default defineTermwrightConfig({
  columns: 60,
  rows: 12,
  command: [binary],
  trace: 'retain-on-failure',
  outputDir: 'termwright-report',
  timeouts: {expect: 10_000, action: 5_000},
  profiles: {ci: {trace: 'on', palette: XTERM_PALETTE}},
});
