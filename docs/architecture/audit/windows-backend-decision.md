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

## Decision

Finish the current addon to a certified contract. Then revisit this table with
the numbers this exercise produces — how much plumbing is actually being
maintained, and whether `portable-pty` would remove it — and treat a switch as
a decision with evidence rather than another turn.

Revisit immediately if the remaining failures turn out to be in the plumbing
rather than the contract: that would mean the cost is not a one-off.

## Open

- Windows support floor (§9): the legacy path is not implemented and no floor
  has been declared. Deciding this needs the modern path certified first.
- Packaging (§30): platform-specific optional dependency packages and prebuilds
  are not built. Today the package is workspace-only and marked `os: win32`,
  which keeps it off other platforms but is not a distribution model.
- Adapter surface: `signal`, `treeState`, `hardKillTree`, `terminate`,
  `attached` and `lifecycle` are not yet mapped onto `PtyProcess`, so the
  backend cannot be selected by the driver even when it works.
