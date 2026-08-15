/**
 * The adapter contract, instantiated for the non-JavaScript adapters.
 *
 * This file is the point of the whole exercise: the suite that certifies
 * `@termwright/ink` certifies a Textual app and a tview app with no changes to
 * itself, because it only ever observes bytes and frames. If an adapter in
 * another language needs the suite bent to fit it, the contract is not a
 * contract.
 *
 * Both registrations are skipped — with the reason in the block's name — when
 * the language's toolchain is not installed here. A missing interpreter is not
 * a conformance result, the same way a missing pseudo-terminal is not one.
 *
 * Parameters (ready text, interaction, quit) come from `clients/README.md`,
 * which is where each adapter's example app documents itself.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAdapterConformance } from '../adapter-conformance.js';
import { repositoryPath } from '../support/pty.js';

const PYTHON_APP = repositoryPath('clients', 'python', 'examples', 'permission_app.py');
const GO_MODULE = repositoryPath('clients', 'go');
/** Built once by the toolchain probe, so no `go run` wrapper outlives a test. */
const GO_BINARY = join(tmpdir(), 'termwright-conformance-permission');

await runAdapterConformance({
  name: 'termwright (Textual)',
  // `python3` rather than `python`: the bare name is Python 2 or absent on
  // several supported platforms.
  requires: {
    probe: ['python3', '-c', 'import termwright, textual'],
    label: 'python3 with termwright and textual installed',
  },
  spawn: () => ({ command: ['python3', PYTHON_APP] }),
  ready: 'Permission required',
  interaction: { input: '\t', expect: 'focus: reject' },
  quit: { input: 'q', exitCode: 0 },
  columns: 80,
  rows: 24,
  expectAbsoluteBounds: true,
});

await runAdapterConformance({
  name: 'termwright (tview)',
  // The probe doubles as the build: it proves the toolchain works *and*
  // produces the binary `spawn` runs, so no test pays a compile and no
  // `go run` parent process is left holding a child.
  requires: {
    probe: ['go', 'build', '-o', GO_BINARY, './examples/permission'],
    label: 'go toolchain able to build the tview example',
    cwd: GO_MODULE,
    timeoutMs: 180_000,
  },
  spawn: () => ({ command: [GO_BINARY] }),
  ready: 'Permission required',
  interaction: { input: '\t', expect: 'focus: reject' },
  // `clients/README.md` documents `q`, and `q` does quit — but only while the
  // focus has not cycled onto the reason field, where it types normally. The
  // suite sends the interaction more than once, so it needs the unconditional
  // key; tview stops on Ctrl+C and exits 0.
  quit: { input: '\u0003', exitCode: 0 },
  columns: 80,
  rows: 24,
  expectAbsoluteBounds: true,
});
