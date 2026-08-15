---
title: Decisions (ADRs)
description: The load-bearing technical decisions, why each was made, and what would make us revisit it.
---

Short records of the choices that shaped termwright. Each says what was decided,
why the alternatives lost, and what would reopen the question.

## ADR-1 — A real pseudo-terminal, and a pinned PTY binding

**Decision.** Every session owns a real pty, spawned through a `PtyBackend`
interface; the implementation is `@lydell/node-pty`, pinned to an exact version.

**Why.** Anything short of a real pty — a pipe, a captured stream, an in-process
fake — changes what the program under test does: raw mode, `SIGWINCH`, terminal
size, `isatty` checks and signal delivery all differ. A test on a fake is
evidence about the fake.

The fork rather than upstream `node-pty` because upstream's stable release lacks
Linux prebuilds, while the fork ships all six platforms as optional
dependencies. It is pinned exactly, with install tests per platform in CI,
because the alternative is a native binding changing under a patch release.

**Known cost.** The fork has a bus factor of one, and its `latest` tag has
pointed at a beta. The `PtyBackend` interface is the insurance: it is the only
place in the driver that knows which binding is in use.

**Revisit when.** Upstream `node-pty` ships a stable release with Linux
prebuilds.

## ADR-2 — `@xterm/headless` as the VT emulator

**Decision.** The grid is modelled by `@xterm/headless` 6.0 with the Unicode 11
addon explicitly activated, plus the serialize addon.

**Why.** Terminal emulation is a deep pit of edge cases — wide characters,
combining marks, scroll regions, alternate buffers, mode handling. xterm.js is
the emulator with the widest real-world exposure, and it is the *same engine*
the [runner UI](../../guides/runner-ui/) renders with, so what a test asserts and
what a human sees cannot diverge.

**Known costs, all handled in code.** Every write is wrapped in a promise on its
callback, because the buffer is asynchronous. Unicode 11 must be activated
explicitly or width calculations silently differ. The headless package is
CJS-only and needs an interop shim in an ESM build. And `terminal.modes` does not
report mouse-encoding modes, so the driver tracks the private `CSI ?h` / `?l`
sequences itself.

**Not solved by this choice.** Yoga (Ink's layout engine) and the Unicode 11
addon disagree on some ZWJ cluster widths. That is a genuine ambiguity in the
ecosystem, not a bug we can fix on one side.

## ADR-3 — An out-of-band semantic channel, with an in-band commit marker

**Decision.** The semantic tree travels over a private local socket. The in-band
stdout marker carries only a revision number and a MAC: it is a **frame commit,
never a data carrier**.

**Why not in-band data.** Encoding a tree into the output stream means the tree
is subject to terminal parsing, size limits, and interleaving with the
application's own writes — and any program that echoes bytes could inject one.

**Why a marker at all.** Without it there is no way to know *which screen* a
tree describes. The marker is emitted after the last byte of its frame, so the
driver publishes a revision only when it holds both the tree and the grid state
at that marker. This is Neovim's `flush` semantics, and it is what makes waits
event-based rather than timing-based.

**Why DCS and not APC.** APC is unsupported by xterm.js. A private DCS sequence
is registrable, and a registered handler consumes it so it never reaches the
visible grid. Verified, not assumed.

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

**Also decided here.** Session state is keyed by MCP session id in *our*
registry, not inside transport objects, which is what makes stdio and Streamable
HTTP interchangeable and keeps the ceilings in one place.

## ADR-5 — `bounds` optional from day one

**Decision.** A semantic node may omit `bounds`, and a snapshot carrying no
bounds at all is valid.

**Why.** The alternative was to require coordinates and thereby exclude every
framework that composes strings or draws in immediate mode — most of the Go and
Rust ecosystems. Role-and-name locators are useful *without* geometry; only
hit-testing genuinely needs it.

**Consequence.** Adapters advertise an `absolute-bounds` capability only when
they can honour it, and consumers must treat a bounds-free snapshot as a normal
state rather than a fault. Ink drops bounds wholesale when `<Static>` shifts its
layout region — the mechanism working as intended.

## ADR-6 — Vitest as the first-class preset, driver runner-agnostic

**Decision.** `@termwright/test` targets Vitest specifically. The driver depends
on no runner.

**Why.** A preset that feels native beats a lowest-common-denominator API that
feels foreign everywhere: `test.extend` fixtures, `expect.extend` matchers with
real typing, reporters, sharding, `--last-failed` and retries all exist already,
and reimplementing them would be a worse scheduler than the one Vitest has.

Keeping that layer thin — roughly 5% of the code — is what keeps `node:test`,
Jest and plain scripts first-class rather than theoretical.

## ADR-7 — Recording on by default

**Decision.** Sessions record to asciicast unconditionally; trace collection
defaults to `retain-on-failure`.

**Why.** A terminal session is cheap to record and expensive to reproduce. The
failure you care about is the one that happened once in CI at 3am, and a tool
that only records when asked never has it. `Hide()` / `Show()` and idle trimming
exist so the default stays cheap enough to leave on.

## ADR-8 — Honest degradation over invented semantics

**Decision.** Where a framework cannot publish meaning, termwright reports
`semanticTree: false` and offers grid-based locators. It never infers roles from
rendered text.

**Why.** A locator that silently matches the wrong cell is worse than one that
refuses: it turns a test suite into a source of false confidence. The same rule
drives `unsupported-action` when mouse tracking is off, `stale-snapshot` when a
ref outlives its revision, and the [Bubble Tea page](../../adapters/bubbletea/)
saying plainly what it cannot do.
