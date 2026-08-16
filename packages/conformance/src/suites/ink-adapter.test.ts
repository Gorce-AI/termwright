/**
 * The adapter contract, instantiated for `@termwright/ink`.
 *
 * This file is also the worked example an adapter author copies: the whole
 * binding between an adapter and the suite is the object below.
 */
import { runAdapterConformance } from '../adapter-conformance.js';
import { CONFORMANCE_FIXTURES } from '../support/pty.js';

await runAdapterConformance({
  name: '@termwright/ink',
  spawn: () => ({ command: [process.execPath, CONFORMANCE_FIXTURES.semanticInk()] }),
  // The same fixture rendered through plain `ink.render`: the dormant-rule
  // comparison needs a build with the adapter genuinely out of the picture.
  baseline: () => ({
    command: [process.execPath, CONFORMANCE_FIXTURES.semanticInk()],
    env: { TERMWRIGHT_CONFORMANCE_PLAIN: '1' },
  }),
  ready: 'Termwright Conformance',
  interaction: { input: '\t', expect: '[Save]' },
  quit: { input: '\u0003', exitCode: 0 },
  // `l` publishes through `@termwright/logs`; the message must reach the
  // driver's log channel and never the screen.
  logs: { input: 'l', expect: 'conformance log record' },
  columns: 80,
  rows: 24,
  expectAbsoluteBounds: true,
});
