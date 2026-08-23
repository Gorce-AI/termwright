# Windows PTY backend — decision record

Status: **provisional.** The backend is implemented and compiling; its contract
is not yet certified. This records what has been decided, what the evidence
says so far, and what would change the decision.

## What is being replaced

Only the Windows branch of `packages/driver/src/pty.ts`:

- `spawn` from `@lydell/node-pty` on win32
- `createWindowsWriteChannel`, which writes through the private `_agent.inSocket`
- `exactWindowsAgent(pty).kill()`, the private agent teardown
- `_getConsoleProcessList()` as the process-tree source
- `observeExactNodePtyOutputBoundary`, which reads the private `_socket`
- the `ready_datapipe` attach barrier

POSIX keeps node-pty. Its master fd ends with EOF or EIO after its queued
bytes, which is the property the whole exercise is about, and it already has
it.

## Why not simply keep node-pty on Windows

Termwright labels its own Windows output `bounded-fallback`, which is an honest
name for node-pty's one-second flush window that resets on every chunk. That is
a heuristic, and a session cannot end on one. Nothing that wraps that timer can
turn it into a boundary.

## Options considered

| Criterion | node-pty as-is | node-pty fork/patch | Own N-API addon | napi-rs + portable-pty |
| --- | --- | --- | --- | --- |
| authoritative EOF | no — timer | possible, but rewriting its lifetime model | yes, by design | yes, would still be ours to add |
| job-object tree ownership | no — PID enumeration | would have to be added | yes | would have to be added |
| no private JS internals | no | n/a | yes | yes |
| plumbing already solved | yes | yes | **no — written here** | yes |
| toolchain added | none | none | C++ / node-gyp | Rust, cargo, napi-rs |
| surface maintained | none | whole package | ~470 lines | glue plus our additions |

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

| | node-pty (native) | WezTerm `portable-pty` |
| --- | --- | --- |
| CreateProcess flags | `EXTENDED_STARTUPINFO_PRESENT \| CREATE_UNICODE_ENVIRONMENT` | same |
| `STARTF_USESTDHANDLES` | not set | set, all three handles `INVALID_HANDLE_VALUE` |
| `ReleasePseudoConsole` | only when using the standalone ConPTY DLL | never |
| shutdown | `ClosePseudoConsole` | `ClosePseudoConsole` in `Drop` |
| end of output | waits on the process handle, then a one-second flush window | not addressed |

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

## Decision

Finish the current addon to a certified contract. Then revisit this table with
the numbers this exercise produces — how much plumbing is actually being
maintained, and whether `portable-pty` would remove it — and treat a switch as
a decision with evidence rather than another turn.

Revisit immediately if the remaining failures turn out to be in the plumbing
rather than the contract: that would mean the cost is not a one-off.

Note that the comparison has already shifted once. `portable-pty` looked like
it would cover "the basics"; reading it shows the basics it covers stop
exactly where our requirement starts. The plumbing it removes is real, and so
is the Rust toolchain it adds.

## Open

- Windows support floor (§9): the legacy path is not implemented and no floor
  has been declared. Deciding this needs the modern path certified first.
- Packaging (§30): platform-specific optional dependency packages and prebuilds
  are not built. Today the package is workspace-only and marked `os: win32`,
  which keeps it off other platforms but is not a distribution model.
- Adapter surface: `signal`, `treeState`, `hardKillTree`, `terminate`,
  `attached` and `lifecycle` are not yet mapped onto `PtyProcess`, so the
  backend cannot be selected by the driver even when it works.
