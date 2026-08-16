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
import { pythonWith, repositoryPath } from '../support/pty.js';

const PYTHON_APP = repositoryPath('clients', 'python', 'examples', 'permission_app.py');
/** `null` when no interpreter here can import the client; the row then skips. */
const PYTHON = pythonWith(['termwright', 'textual']);
const GO_MODULE = repositoryPath('clients', 'go');
/** Built once by the toolchain probe, so no `go run` wrapper outlives a test. */
const GO_BINARY = join(tmpdir(), 'termwright-conformance-permission');

await runAdapterConformance({
  name: 'termwright (Textual)',
  // Resolved to an absolute interpreter path: the name differs by platform and
  // `node-pty` could not spawn `python3` on Windows even where a plain probe
  // of the same name succeeded.
  requires: {
    probe: [PYTHON ?? 'python3', '-c', 'import termwright, textual'],
    label: 'a python with termwright and textual installed',
  },
  spawn: () => ({ command: [PYTHON ?? 'python3', PYTHON_APP] }),
  ready: 'Permission required',
  interaction: { input: '\t', expect: 'focus: reject' },
  // Logs once at startup through the stdlib logging bridge, like the tview
  // example, so the obligation waits for the record rather than provoking it.
  logs: { expect: 'no policy loaded' },
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
  // The Go client dials `net.DialTimeout("unix", …)` — `clients/go/protocol/
  // client.go:133` — and the endpoint this harness hands a child on Windows is
  // a named pipe. So the binary builds, runs, and stays dormant, which the
  // suite would otherwise report as "no snapshot ever arrived" on every
  // Windows run. The Python client meets the same wall and *declares* it
  // (`clients/python/src/termwright/client.py:148`), which is the treatment
  // this row borrows until the Go client either dials a pipe or says it cannot.
  unsupported: {
    when: process.platform === 'win32',
    reason: 'the Go client has no named-pipe transport, so it cannot reach a Windows endpoint',
  },
  spawn: () => ({ command: [GO_BINARY] }),
  ready: 'Permission required',
  // The tview example logs at startup rather than on a keystroke, so the
  // obligation waits for the record instead of provoking one.
  logs: { expect: 'no policy loaded' },
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
  expectAbsoluteBounds: true,
});
