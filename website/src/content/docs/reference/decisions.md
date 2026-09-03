---
title: Decisions (ADRs)
pagefind: false
description: The load-bearing technical decisions, why each was made, and what would make us revisit it.
---

Short records of the choices that shaped termwright. Each says what was decided,
why the alternatives lost, and what would reopen the question.

The core testing-model decisions (effective session contract, evidence
providers, ActionPlanner, real input devices, observation semantics, identity,
geometry, revisions, query domains, and certified framework injection) are
maintained in the repository's
[`core-testing-model-decisions.md`](https://github.com/Gorce-AI/termwright/blob/main/docs/architecture/core-testing-model-decisions.md).

## ADR-1 — A real, Termwright-owned pseudo-terminal

**Decision.** Every session owns a real pty, spawned through a `PtyBackend`
interface. The implementation is the Termwright-owned `@termwright/pty` native
addon, shipped through six platform/architecture prebuild packages.

**Why.** Anything short of a real pty — a pipe, a captured stream, an in-process
fake — changes what the program under test does: raw mode, `SIGWINCH`, terminal
size, `isatty` checks and signal delivery all differ. A test on a fake is
evidence about the fake.

The addon owns the POSIX `forkpty()` master or Windows pseudoconsole directly.
It observes the operating system's real output EOF, keeps writes ordered and
owns the complete process group/job. Windows ships `conpty.dll` and
`OpenConsole.exe` built together from pinned Microsoft Terminal source commit
`dd494ac79a82a04e1e7252a91c8939a3c3039908` with an exact-fenced T3 patch. The
release gate certifies the resulting binaries and behavior. It validates those
exact runtime assets and fails closed instead of using an inbox
conhost with non-causal frame emission. A private request-addressed `OSC 8488`
exchange synchronizes the host's cursor shadow, while ordinary DSR/CPR remains
application-owned through Win32 Input Mode. No primer, timer, quiet window,
retry, or private field in another package defines successful synchronization
or lifecycle completion.

Input admission is capped at 8 MiB and fails synchronously on overflow; an OS
write failure closes it permanently. Native output crosses a bounded event
queue, so a busy JavaScript consumer backpressures the PTY instead of consuming
memory without limit. Teardown aborts that queue before joining its producers.

**Known cost.** Termwright maintains native C++ and six release artifacts. The
release matrix builds and opens every packed addon on its real OS/architecture;
clean-install smoke tests prove the loader and matching optional dependency
together.

**Revisit when.** Another public PTY API can provide authoritative EOF, ordered
backpressured writes, and complete tree ownership without weakening any of
those contracts.

## ADR-2 — `@xterm/headless` as the VT emulator

**Decision.** The grid is modelled by `@xterm/headless` 6.0 with Termwright's
Unicode 15 extended-grapheme provider explicitly activated, plus serialization.

**Why.** Terminal emulation is a deep pit of edge cases — wide characters,
combining marks, scroll regions, alternate buffers, mode handling. xterm.js is
the emulator with the widest real-world exposure, and it is the _same engine_
the [runner UI](../../tools/runner-ui/) renders with, so what a test asserts and
what a human sees cannot diverge.

**Known costs, all handled in code.** Every write is wrapped in a promise on its
callback, because the buffer is asynchronous. The provider must be activated
explicitly or width calculations silently differ. The headless package is
CJS-only and needs an interop shim in an ESM build. And `terminal.modes` does not
report mouse-encoding modes, so the driver tracks the private `CSI ?h` / `?l`
sequences itself.

**Independent evidence.** Ghostty and libvterm run as conformance references.
They do not become production switches; differences are recorded in the
bidirectional Unicode gap ledger.

## ADR-3 — An out-of-band semantic channel, with an in-band commit marker

**Decision.** The semantic tree travels over a private local socket. The in-band
stdout marker carries only a revision number and a MAC: it is a **frame commit,
never a data carrier**.

**Why not in-band data.** Encoding a tree into the output stream means the tree
is subject to terminal parsing, size limits, and interleaving with the
application's own writes — and any program that echoes bytes could inject one.

**Why a marker at all.** Without it there is no way to know _which screen_ a
tree describes. The marker is emitted after the last byte of its frame, so the
driver publishes a revision only when it holds both the tree and the grid state
at that marker. This is Neovim's `flush` semantics, and it is what makes waits
event-based rather than timing-based.

**Why OSC 8487.** A permeability probe against the former frame-based inbox
ConPTY found that it dropped DCS, APC and OSC 8 while forwarding private OSC
and OSC 133. That result replaced the original DCS choice with private OSC 8487
and a BEL terminator. The current pinned passthrough ConPTY forwards those
escape families, but OSC 8487 remains the single measured marker encoding on
every platform. A registered OSC handler consumes it before it reaches the
visible grid.

**Why a MAC.** So ordinary program output — including output a test's own
fixture prints — cannot forge a commit. It is keyed with the per-session token
and binds session and revision, so it cannot be replayed across either.

**Why never TCP.** A local socket in a `0700` directory, or a named pipe with an
unguessable name, is not reachable from another user or another machine. A test
harness that opened a port would be a remote-control interface for whatever is
under test.

## ADR-4 — MCP behind our own facade, Zod v4 from day one

**Decision.** `@termwright/mcp` uses the MCP SDK v1.30 through an internal
facade module, and validates with Zod v4.

**Why.** The SDK is mid-migration to a v2 package split. A facade means that
migration touches one file rather than twenty tool handlers. Zod v4 from the
start avoids a second migration later, and the schemas are the single source
from which `agent-context` and the agent-skill package are generated — so a
documented parameter cannot drift from a real one.

**Also decided here.** Session state is keyed by MCP session id in _our_
registry, not inside transport objects, which is what makes stdio and Streamable
HTTP interchangeable and keeps the ceilings in one place.

## ADR-5 — Geometry is evidence-qualified

**Decision.** Every semantic node publishes separate `displayed`,
`intendedRect`, and `visibleRect` observations. Each observation states whether
the fact is known, absent, unknown, or unsupported.

**Why.** Frameworks expose different physical facts. A render rectangle does
not prove clipping or pointer ownership, and omitting that distinction creates
false visibility and action results.

**Consequence.** Adapters claim `intended-geometry`, `clipped-geometry`, and
`pointer-hit-grid` independently and only from authoritative framework facts.
Consumers branch on the observation status rather than treating missing
evidence as a rectangle or boolean.

## ADR-6 — Termwright owns the test host; Vitest is the embedded engine

**Decision.** `termwright test`, `termwright watch`, and `termwright ui` are the
only product execution modes. They share one Termwright-owned host and its
exact-certified Vitest engine. `@termwright/test` supplies the authored DSL,
fixtures and matchers; the driver remains independently reusable as a library.

**Why.** Vitest already provides collection, Vite transforms, mocks, assertions
and the familiar test DSL. It does not understand PTY cost, process trees,
paired semantic revisions, Attempt identity or terminal artifact durability.
Termwright therefore embeds Vitest instead of replacing it, while owning every
terminal-specific execution and certification boundary around it.

**Consequence.** There is no direct-Vitest compatibility runner, reporter-only
fallback, file/title execution identity, or migration layer to maintain. The
exact runner fails closed without its host context. Plain scripts may still use
the low-level driver, but they are not certified Termwright test runs.

## ADR-7 — Recording on by default

**Decision.** Sessions record to asciicast unconditionally; trace collection
defaults to `retain-on-failure`.

**Why.** A terminal session is cheap to record and expensive to reproduce. The
failure you care about is the one that happened once in CI at 3am, and a tool
that only records when asked never has it. `Hide()` / `Show()` and idle trimming
exist so the default stays cheap enough to leave on.

## ADR-8 — Unsupported semantics remain explicit

**Decision.** Where a framework cannot publish meaning, termwright reports
`semanticTree: false` and offers grid-based locators. It never infers roles from
rendered text.

**Why.** A locator that silently matches the wrong cell is worse than one that
refuses: it turns a test suite into a source of false confidence. A missing
negotiated capability, a disabled runtime input mode, and a currently
non-actionable target are distinct typed errors. A stale ref remains a
`stale-snapshot`, and the [Bubble Tea page](../../adapters/bubbletea/) says
plainly what its certified contract can and cannot do.

## ADR-9 — Electron is a thin host, not another runner

**Decision.** The desktop surface loads the same authenticated loopback URL and
the same renderer as the browser in a sandboxed Electron `BrowserWindow`. The
host owns only the native window. The CLI continues to own
Vitest and coordinated shutdown; `@termwright/ui` continues to own the server,
live/replay model and renderer bundle.

**Surface contract.** Interactive `termwright ui` defaults to the Termwright
desktop window. `--browser` chooses the system browser. `--no-open`, JSON, CI
and non-TTY use no window. The server and React application are identical in all
three modes.

**Security boundary.** Electron does not bypass the per-launch token. The host
accepts only the exact loopback origin, grants the renderer no Node integration,
preload or IPC in version one, enables context isolation and sandboxing, and
denies unexpected navigation, windows, permissions and network requests.
External editor URLs cannot be forwarded blindly to the operating system.

**Packaging boundary.** The umbrella package includes the separately built thin
host. The launcher produces a platform-native `Termwright` bundle with the
canonical icon and a fingerprinted cache. Closing the window shuts down the
watcher and server. Packaged native smoke tests and the production
`BrowserWindow` policy are release gates.
