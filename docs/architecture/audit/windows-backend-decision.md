# Windows PTY backend — decision record

Status: **accepted and unified; passthrough-runtime certification pending.** Windows uses the Windows branch of
the Termwright-owned `@termwright/pty` N-API backend. Darwin, Linux, and Windows
arm64/x64 addons share one conditional loader and six prebuild packages. A
missing or unloadable addon fails closed; no supported platform falls back to
node-pty. CI certifies real host behavior and the release matrix validates all
six native artifacts. The 0.3 release candidate additionally carries a
standalone ConPTY built from one pinned Microsoft Terminal source commit with
one exact-fenced T3 patch. It may ship only after its binaries and behavioral
contract are certified, and it never falls back to the Windows inbox conhost.

The investigation below is retained as historical decision evidence. Its
intermediate failures and hypotheses do not describe the current backend.

## What is being replaced

The former Windows branch of `packages/driver/src/pty.ts`:

- `spawn` from `@lydell/node-pty` on win32
- `createWindowsWriteChannel`, which writes through the private `_agent.inSocket`
- `exactWindowsAgent(pty).kill()`, the private agent teardown
- `_getConsoleProcessList()` as the process-tree source
- `observeExactNodePtyOutputBoundary`, which reads the private `_socket`
- the `ready_datapipe` attach barrier

The later cross-platform migration also replaced node-pty on POSIX. The unified
addon now owns the `forkpty()` master itself, so EOF/EIO and process-group
ownership are public Termwright contracts rather than certified private fields.

## Why not simply keep node-pty on Windows

Termwright labels its own Windows output `bounded-fallback`, which is an honest
name for node-pty's one-second flush window that resets on every chunk. That is
a heuristic, and a session cannot end on one. Nothing that wraps that timer can
turn it into a boundary.

## Options considered

| Criterion                 | node-pty as-is       | node-pty fork/patch                        | Own N-API addon       | napi-rs + portable-pty          |
| ------------------------- | -------------------- | ------------------------------------------ | --------------------- | ------------------------------- |
| authoritative EOF         | no — timer           | possible, but rewriting its lifetime model | yes, by design        | yes, would still be ours to add |
| job-object tree ownership | no — PID enumeration | would have to be added                     | yes                   | would have to be added          |
| no private JS internals   | no                   | n/a                                        | yes                   | yes                             |
| plumbing already solved   | yes                  | yes                                        | **no — written here** | yes                             |
| toolchain added           | none                 | none                                       | C++ / node-gyp        | Rust, cargo, napi-rs            |
| surface maintained        | none                 | whole package                              | ~470 lines            | glue plus our additions         |

## What the evidence says so far

Two things separate cleanly, and they point in opposite directions.

**Our differentiator worked immediately.** The job object reported a live
process and an empty tree after a hard kill on the first run that executed.
Feature detection of `ReleasePseudoConsole` returned true and was correct. The
ordered native-to-JS channel has never mis-ordered anything.

**The plumbing cost four CI rounds.** Every failure so far has been in the part
a mature library would already have solved:

1. `include_dir` versus `include` for the addon headers.
2. `CREATE_NO_WINDOW` silently detaching the child from the pseudoconsole.
3. Events emitted before the delivery gate was armed.
4. Three wrong placements of `ReleasePseudoConsole`, each tearing the console
   down before a short-lived child's output was rendered.

That is an argument for taking the plumbing from somewhere else. It is recorded
here rather than acted on mid-debug, because swapping the foundation while the
current one is one fix from green would trade a nearly-finished problem for a
fresh one.

## What the reference implementations actually do

Read rather than assumed, after four rounds of guessing at ConPTY semantics.

|                        | node-pty (native)                                            | WezTerm `portable-pty`                        |
| ---------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| CreateProcess flags    | `EXTENDED_STARTUPINFO_PRESENT \| CREATE_UNICODE_ENVIRONMENT` | same                                          |
| `STARTF_USESTDHANDLES` | not set                                                      | set, all three handles `INVALID_HANDLE_VALUE` |
| `ReleasePseudoConsole` | only when using the standalone ConPTY DLL                    | never                                         |
| shutdown               | `ClosePseudoConsole`                                         | `ClosePseudoConsole` in `Drop`                |
| end of output          | waits on the process handle, then a one-second flush window  | not addressed                                 |

Three conclusions follow.

**Dropping the release was right.** Neither implementation depends on it, and
the run proves it was never the cause here: with no release at all, the output
is still only ConPTY's first frame. Three rounds went into moving a call that
did not matter.

**Neither has an authoritative EOF.** node-pty reaches for a timer, which is
the exact thing this package exists to remove; WezTerm does not answer the
question. So adopting `portable-pty` would buy the plumbing and leave the
differentiator still to be written — which changes the arithmetic in the table
above rather than settling it.

**One concrete difference remained.** WezTerm sets `STARTF_USESTDHANDLES` with
invalid handles, saying explicitly that the child inherits none and must take
its console's. A stream carrying ConPTY's frame and none of the child's output
is what its absence would look like.

Microsoft's shutdown discussion (microsoft/terminal#19112) adds one more: an
unclosed ConPTY-side pipe handle makes `ReadFile` block for ever. This code
closes both as soon as `CreatePseudoConsole` has them, so that hazard is
already avoided.

## What the instrumented run established

The two remaining failures were made to report an intermediate fact rather
than a fourth hypothesis. Both answered in one round.

**The descendant was never lost.** The root reported a real pid for it, and
the operating system said that pid was already gone when the test looked. The
`exit` event was emitted at the bottom of `WaitForRootExit`, after the job had
drained and the console had been closed, so every listener asking what the
tree looked like at root exit was told nothing was left. That was the event
lying about its own timing, not the job failing to hold a descendant. Root
exit is now reported when the root exits.

**The silent child is an input-path fault.** The console came up, the job held
one member before the write and one after it, and the child never saw the
keystroke. That rules out both explanations the earlier timeout allowed —
the session did start, and the child did not die. What is not yet known is
whether the child was handed a standard input that is a terminal at all; it
now reports that before it waits.

Cost so far: four rounds spent guessing, one round spent asking. Every
remaining boundary in this backend should be approached the second way.

## The console, not the job, ends a descendant — platform, not backend

This was written as a mandatory property and it is not one Windows offers.
The evidence, gathered in that order:

| Question                              | Answer               | How it was obtained                                                                                          |
| ------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| Was the descendant created?           | yes, with a real pid | the root reported it                                                                                         |
| Did it run and reach the console?     | yes                  | it printed its own line first                                                                                |
| Was it inside the job?                | yes — two members    | job census while the root was alive                                                                          |
| Was it alive at root exit?            | no                   | `process.kill(pid, 0)` from the test                                                                         |
| What did the job say at that instant? | zero members         | counted natively inside the session, before the drain and before the console close                           |
| Did it finish or was it cut off?      | cut off              | its journal stops before the exit hook it installed, with work still pending                                 |
| Is the console what kills it?         | yes                  | the same case run detached from the console survives its root, stays in the job, and is still killable by it |

The count is taken in the session's own exit path, immediately after the
root's handle is signalled, so nothing in this backend had acted yet. The last
row is the one that names the cause: a descendant with no console outlives its
root by its own record, while a console-attached one with pending work never
reaches it. The difference between the two cases is the console and nothing
else.

Neither Microsoft's documentation nor conhost's source predicts this.
`ClosePseudoConsole` is documented to terminate attached clients, and
`CloseConsoleProcessState` is reached from a broken output pipe, which is the
host having stopped reading — not what happens here. `RemoveConsole` only
recomputes the window owner when the root leaves. So this is an observed
platform behaviour with no documented mechanism, which is exactly why it is
pinned by a test rather than trusted to a comment.

One earlier version of that test proved less than it claimed: with the root
alive for two seconds and the descendant writing at four hundred milliseconds,
the descendant simply ran out of work and exited on its own, and "gone by root
exit" was satisfied for that reason. Three cases now each mean one thing —
delivery with a clean finish, a cut-off with work pending, and the detached
control.

What this costs: a Windows session cannot promise that output written after
its root exits will arrive, because the console takes its writers with it. The
practical shape of that is a launcher command which starts the real
application and returns — the application goes with it. Configure the
application itself, not a wrapper that exits.

What it does not cost: everything written before that point is still delivered
before the stream ends, the end is still the pipe ending rather than a timer,
and ownership of the tree does not depend on the console — a detached
descendant is still counted by the job and still killed by it.

## Decision

Ship the current addon as the mandatory Windows backend. Its ordered pipes give
an OS-backed output boundary, its job object owns the process tree, and its
adapter now implements the driver lifecycle surface. Platform prebuilds are
published as optional dependencies selected by npm; the parent package throws
a typed error when the matching addon is unavailable.

Reconsider the backend only with new evidence that another implementation
preserves the same EOF, ownership, packaging and fail-closed contracts. A
smaller implementation is useful only if it does not restore timer-based drain
or weaken tree cleanup.

## Ordered semantic frames: vendored passthrough ConPTY

The legacy inbox conhost invalidated an in-band frame barrier. It rendered text
through an asynchronous VtEngine frame while passing an unknown OSC marker by
a different path, so a marker written after text could appear first in the
output pipe. `CONOUT$` did not repair the contract: its screen-buffer state and
the emitted VT stream had no shared acknowledgement.

Termwright pins Microsoft Terminal source commit
`dd494ac79a82a04e1e7252a91c8939a3c3039908` and applies one exact-fenced T3
patch for request-addressed host cursor synchronization. `conpty.dll` and
`OpenConsole.exe` are built together from that same patched tree; mixing a DLL
and host from different builds is outside the candidate contract. This
runtime's ConPTY path passes client VT into one ordered output stream without
the legacy renderer. The addon finds its own module directory, validates the
exact DLL and all required native-host hashes, loads the DLL by absolute path,
verifies the final mapped path, and retains one immutable Create/Resize/Close
table for every `HPCON`. The addon still loads far enough to expose a structured
capability report for missing, partial, modified, wrong-export, or wrong-layout
bundles, but session creation fails closed before application code starts.

This is deliberately a scoped candidate claim: a framework must still flush
its own output before writing its authenticated marker. Certification must
prove that ConPTY does not reorder those already-issued writes. Node, Bun, legacy
`WriteConsoleW`, rapid A→B→A frames, alternate screen, pressure, resize, and
real EOF are tested on x64, ARM64, and x64 Node under ARM64 emulation. A quiet
window remains only where a caller explicitly requests a heuristic; it is not
evidence for authoritative semantic publication.

### Request-addressed host cursor synchronization

The unmodified host used standard DSR/CPR both for its own cursor shadow and for
application terminal queries. Those byte-identical replies could not carry
provenance. A rejected experiment tried to prime OpenConsole's input parser
before a raw CPR, but a later host capture could still consume or retain the
wrong application reply. The primer and capture-state arbitration are not part
of the shipped design.

The T3 patch replaces the host-owned query with private `OSC 8488` messages:
`twh-cpr-v1:q:<32-lowercase-hex-token>` requests the cursor and
`twh-cpr-v1:r:<same-token>:<row>:<column>` answers it. The token is a fresh
random 128-bit value. The emulator reads its active cursor at the exact parser
position of the request. OpenConsole accepts only the matching live token;
superseded host replies are consumed without entering the application's input
queue. Ordinary standard DSR/CPR is always application-owned and reaches the
child through synthesized Win32 Input Mode records. Startup DA1 remains a
separate raw host-control exchange.

The only positive completion is a matching response for the live request.
Supersession and session close cancel the waiter fail-closed without publishing
stale cursor state. No primer, timeout, retry, quiet window, or pending-capture
guess proves synchronization. A missing RPC capability, mismatched source or
binary digest, or failed behavioral test keeps the runtime uncertified and
session creation fails closed.

### Upstream legacy-API translation risks

The passthrough rewrite still translates legacy Console API calls into VT.
Microsoft tracks known fidelity defects in
[microsoft/terminal#17643](https://github.com/microsoft/terminal/issues/17643),
including edge cases around SGR 53, graphemes during active-buffer changes, and
alternate-buffer scrollback. These do not invalidate the ordered-byte barrier:
they can change how a legacy operation is represented, but do not reorder a
framework's already-issued bytes around its following marker. Termwright's
certification therefore tests both contracts separately: marker ordering is a
release gate, while legacy translation cases stay an explicit upstream risk to
revalidate whenever the pinned ConPTY version changes. VT-native applications
do not depend on those legacy translations.

The authoritative marker also follows a strict same-handle invariant. Each
probe writes rendered bytes and the following marker synchronously through the
framework-owned output handle, under its render/publish lock or ordered writer.
Termwright deliberately does not reopen `CONOUT$` for the marker: if application
code switched the framework handle to an inactive legacy screen buffer, writing
the marker to another active buffer would publish semantics for a render the
user cannot see. Instead the marker stays with the render, pairing remains
incomplete, and the operation fails closed. VT alternate-screen switching is
in-band and fully supported; arbitrary concurrent `CreateConsoleScreenBuffer`
or `SetConsoleActiveScreenBuffer` calls outside the framework-owned render path
are not part of the zero-config contract.

## Remaining platform boundary

Certification currently runs on GitHub's `windows-latest` image and does not
claim a separate legacy-Windows support floor. On the certified platform,
Windows may terminate console-attached descendants when the root process exits.
Applications must therefore be launched directly: a wrapper that starts the
real application and exits cannot promise delivery of the application's later
output. Termwright records and tests this limitation rather than hiding it with
a drain timer.
