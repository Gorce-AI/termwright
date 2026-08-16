/**
 * The adapter contract, instantiated for `@termwright/ink`.
 *
 * This file is also the worked example an adapter author copies: the whole
 * binding between an adapter and the suite is the object below.
 */
import { fileURLToPath } from 'node:url';
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
  conventions: {
    annotatedTestId: 'save-main',
    emptyTextboxTestId: 'filter',
    unnamedContainerTestId: 'unnamed-region',
    // `unicode` is a `text` node whose value the fixture annotates, which the
    // role gate allows; everything else must derive none.
    annotatedValues: ['unicode'],
    // `URL.pathname` yields `/D:/…` on Windows, which no fs call accepts — the
    // Windows CI run reported this adapter as declaring nothing at all.
    readmePath: fileURLToPath(new URL('../../../ink/README.md', import.meta.url)),
  },
  columns: 80,
  rows: 24,
  expectAbsoluteBounds: true,
});
