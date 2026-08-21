/**
 * The adapter contract, instantiated for the non-JavaScript adapters.
 *
 * The reusable suite only observes bytes and frames. If an adapter in another
 * language needs it bent to fit, the contract is not a contract.
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
import { pythonWith, repositoryPath } from '../support/pty.js';

const PYTHON_APP = repositoryPath('clients', 'python', 'examples', 'permission_app.py');
/** `null` when no interpreter here can import the client; the row then skips. */
const PYTHON = pythonWith(['termwright', 'textual']);
/** Built once by the toolchain probe, so no `go run` wrapper outlives a test. */
const GO_BINARY = join(tmpdir(), 'termwright-conformance-tview');
const GO_BASELINE = join(tmpdir(), 'termwright-conformance-tview-plain');
const GO_BUILD = repositoryPath('packages', 'conformance', 'scripts', 'build-tview-fixture.mjs');

await runAdapterConformance({
  name: 'termwright (Textual)',
  // Resolved to an absolute interpreter path: the name differs by platform and
  // `node-pty` could not spawn `python3` on Windows even where a plain probe
  // of the same name succeeded.
  requires: {
    probe: [PYTHON ?? 'python3', '-c', 'import termwright, textual'],
    label: 'a python with termwright and textual installed',
  },
  spawn: () => {
    const interpreter = PYTHON ?? 'python3';
    return {
      command: [interpreter, '-m', 'termwright_probe', '--', interpreter, PYTHON_APP],
    };
  },
  ready: 'Permission required',
  interaction: { input: '\t', expect: 'focus: reject' },
  conventions: {
    // Textual exposes DOM ids natively, which rule 3 requires an adapter to
    // accept alongside an explicit annotation.
    annotatedTestId: 'reason',
    emptyTextboxTestId: 'reason',
    readmePath: repositoryPath('clients', 'python', 'README.md'),
  },
  // `clients/README.md` documents `q`, and the app binds it — but Tab
  // eventually lands on the `Input`, which swallows it. Ctrl+Q is Textual's
  // own priority binding and quits from any focus; Ctrl+C does not.
  quit: { input: '\u0011', exitCode: 0 },
  columns: 80,
  rows: 24,
  expectIntendedGeometry: true,
});

await runAdapterConformance({
  name: 'termwright (tview)',
  // The probe doubles as the build: it proves the toolchain works *and*
  // produces the binary `spawn` runs, so no test pays a compile and no
  // `go run` parent process is left holding a child.
  requires: {
    probe: [process.execPath, GO_BUILD],
    label: 'go toolchain able to build the tview example',
    timeoutMs: 180_000,
  },
  // This row was skipped on win32 while the Go client dialled a unix socket
  // unconditionally: on Windows it reached a named pipe, failed the handshake,
  // and — because a failed handshake is deliberately survivable — ran on
  // publishing nothing. `clients` gave it a per-platform transport (2b29d9e,
  // `winio.DialPipe` behind a build tag), so the row runs everywhere again.
  // Certified on Windows by CI rather than here: this machine can only say
  // that the example still cross-compiles for it.
  spawn: () => ({ command: [GO_BINARY] }),
  baseline: () => ({ command: [GO_BASELINE] }),
  ready: 'Permission required',
  interaction: { input: '\t', expect: 'focus: reject' },
  // tview exposes no native identifier, so the id-based checks have nothing to
  // address; its README declares that under rule 3.
  conventions: { readmePath: repositoryPath('clients', 'go', 'README.md') },
  // `clients/README.md` documents `q`, and `q` does quit — but only while the
  // focus has not cycled onto the reason field, where it types normally. The
  // suite sends the interaction more than once, so it needs the unconditional
  // key; tview stops on Ctrl+C and exits 0.
  quit: { input: '\u0003', exitCode: 0 },
  columns: 80,
  rows: 24,
  expectIntendedGeometry: true,
});
