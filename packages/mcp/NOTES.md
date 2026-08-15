# @termwright/mcp — implementation notes

Decisions that are not obvious from the code, and the open threads other package
owners need to know about.

## Two revision counters, and which one is which

The compact format has one `revision` in its header and one inside every ref.
They are **different counters**, and CONTRACTS.md's example happens to show them
equal:

- the header revision is the **screen** revision. It is the value
  `terminal.capture_since` takes as `cursor`, because it exists in every session,
  including ones with no adapter;
- a ref's revision (`n8@42`) is the **semantic** revision, so refs are
  byte-identical to the ones `@termwright/driver` puts on `ResolvedTarget` and
  can be quoted back and forth without translation.

`terminal.snapshot` returns both explicitly (`revision`, `cursorValue` and
`semanticRevision`) so an agent never has to infer which is which.

## Refs are resolved by this package, not by the driver

The driver has no public "locator for this ref" factory: refs are outputs of
`Locator.resolve()`. `targets.ts` therefore looks a ref up in the *current*
semantic tree and rebuilds the narrowest driver locator for that node
(`getByTestId` when the node has a test id, otherwise `getByRole` + exact name).
Strictness, waiting and candidate diagnostics stay in the driver.

A ref whose revision is not the live semantic revision fails with
`stale-snapshot` before any locator is built — the driver's own rule, applied at
the one place where refs re-enter the system.

**If the driver ever grows `harness.locatorForRef(ref)`**, `locatorForRef()` in
`targets.ts` collapses to one line and no call site moves.

## `settleSemantics` — the gap between "announced" and "observable"

`capabilities().semanticTree` is true from a successful handshake, but
`semanticTree()` stays `null` until a tree *and* its render-commit marker have
been paired. A snapshot taken immediately after `wait_for text` would otherwise
report `semanticTree: unavailable` for a program that does publish one.

`tools.ts: settleSemantics()` waits out that gap with the public
`waitForStable()` (2 s budget) and swallows the timeout — a session that really
has no observable tree is reported honestly rather than being made to look
broken. The driver's locators already wait this way internally; this only aligns
the *read* tools with them.

## Structured errors travel in `_meta`, not in `structuredContent`

An MCP client that has seen `tools/list` validates `structuredContent` against
the tool's `outputSchema` — including for results with `isError: true`. Putting
an error object there made the SDK client reject the response before the agent
could read it (reproduced over Streamable HTTP; the in-memory client only
skipped it because it had never listed tools).

So a failure carries the human-readable rendering in `content` and the same
payload structured in `_meta["io.termwright/error"]`
(`server.ts: ERROR_META_KEY`). The alternative — making every success field
optional so one schema covers both shapes — would have gutted the output schemas
that make the tools legible in the first place.

## `capture_since` diffs locally instead of depending on `@termwright/trace`

CONTRACTS.md §Dependency rules allow this package `driver` + the MCP SDK, and
nothing in the dependency graph lets `mcp` reach `trace`. The diff needed here is
also a different thing from a trace concern: changed screen rows plus the
*minimal changed subtree roots* rendered in the compact ref format, capped for an
agent's context window. `diff.ts` is ~120 lines with its own tests.

If `@termwright/trace` ever exports a `diffSemanticSnapshots` with the same
"minimal roots" semantics and the dependency rules are relaxed, swapping is a
one-import change in `diff.ts`.

## One source of truth for the closed sets

`model.ts` re-exports `SEMANTIC_ROLES` and the snapshot types from
`@termwright/protocol`, and `sessions.ts` takes its session ceiling from
`DEFAULT_LIMITS.maxSessions`. CONTRACTS.md allows this package to import the
protocol's constants and types, so nothing about roles, states or limits is
restated here — the tool schemas an agent reads are generated from the protocol's
own lists.

`ROLES_ARE_COMPLETE` survives as a regression lock with a sharper job than
before: it compares the roles the **driver** can report against the roles the
**protocol** defines, and stops type-checking (naming the offending member) if
the two ever diverge. Verified by temporarily widening one side — the build fails
with `["role drift", …]`. Screen- and session-shaped types still come from the
driver, which owns them.

## Environment handling

A child inherits only `PATH`, `HOME`, `LANG`, `LC_ALL`, `SHELL`, `TMPDIR`,
`USER` and `TERM` unless a caller passes `inheritEnv: true`; anything else has to
be named explicitly in `env`. Nothing about the environment — and nothing about
the session token, which only the driver ever sees — appears in a tool result, in
the compact snapshot or in a log line.

Note that the driver merges its own inheritance on top of `process.env` before
applying `options.env`, so `inheritEnv: false` is a *narrowing of intent* at the
MCP layer today rather than an isolation guarantee. Real isolation needs the
driver to accept "replace the environment" semantics.

**TODO (needs driver):** an explicit `envMode: 'inherit' | 'replace'` on
`LaunchOptions`, so an agent-facing server can actually withhold the operator's
environment from an untrusted child.

## The `skill` package is generated, not written

`agent-skill.ts` renders `SKILL.md`, `reference.md` and `agent-context.json` from
the same zod schemas the tools register, so a parameter that changes changes the
distributed skill in the same commit. The prose in `SKILL.md` is the only
hand-written part, and it is deliberately short: what the loop is, how to read a
snapshot, which revision is which, and what to do per error kind.

## Screenshots

`terminal.snapshot { variant: "full" }` writes the complete dump — text, ANSI and
`screen.html()` — to `<tmp>/termwright-mcp/<session>/<terminal>/snapshot-N.json`
and returns only refs plus the path. That is the whole picture story for 1.0.

**TODO (1.0+):** real `ImageContent` (PNG) needs a rasteriser. Headless Chromium
is not acceptable in this package's dependencies; the candidates are a small
ANSI→PNG renderer or handing the HTML to `@termwright/trace`'s report renderer.
Until then no tool returns `ImageContent`.

## Session ownership

`SessionRegistry` maps a session key (`stdio`, `in-memory`, or an
`Mcp-Session-Id`) to a `TerminalStore` plus whatever the transport needs. The
transports never hold session state themselves, which is what makes stdio and
Streamable HTTP interchangeable and keeps the ceilings in one place.

Per-terminal history for `capture_since` is a 16-entry ring of
`{ revision, semanticRevision, rows, semantic }`. Nothing else is retained, and a
cursor that fell out of the ring fails with `history-truncated` listing the
cursors that are still valid.
