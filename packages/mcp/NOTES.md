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

## Refs go straight to the driver

`harness.locatorForRef(ref)` (driver f78174f) resolves a ref by node **identity**
and owns its staleness rule, so `targets.ts` just calls it. That is strictly
better than the workaround it replaced — rebuilding a locator from role plus
exact name — which made two same-named buttons ambiguous and could not express a
grid ref at all. Grid refs (`grid:1,2,9,1@7`) now work for free.

The malformed-ref and superseded-ref failures are the driver's, verbatim: kinds
`unsupported-action` and `stale-snapshot` with the driver's own suggestion. The
suggestion is phrased for a library caller ("re-resolve the locator"); the
MCP-flavoured advice ("call terminal.snapshot again") lives in the server
instructions and in `SKILL.md`, per error kind, rather than by rewriting what the
driver said.

## `settleSemantics` — reads wait for renders to pair

A screen revision lands before the semantic revision it belongs to: the tree
arrives on the socket, the render-commit marker in the byte stream, and only the
pair is observable. Two symptoms follow if a read tool does not wait. A snapshot
taken right after `wait_for text` reports `semanticTree: unavailable` for a
program that does publish a tree. And `capture_since` reports changed *rows* with
no changed *subtrees*, because it caught the pair mid-flight — this one was
intermittent in the end-to-end suite, and an agent polling `capture_since` after
an action would have hit exactly the same race.

`tools.ts: settleSemantics()` therefore calls the public `waitForStable()` before
every read: 2 s for a session still waiting for its first tree, 250 ms to let an
in-flight render pair. Timeouts are swallowed — a session with no observable tree
is reported honestly rather than made to look broken.

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

## Environment handling belongs to the driver

`LaunchOptions.envMode` (driver f78174f) defaults to `'replace'`: the child gets
PATH, HOME, LANG, LC_ALL, SHELL, TMPDIR, USER and TERM plus whatever `env` names,
and nothing else. `terminal.launch` exposes that enum directly instead of the
`inheritEnv` boolean it used to carry, so the tool schema speaks the same
vocabulary as the library and the allowlist has exactly one owner. The local copy
of the allowlist is gone.

This is now a real isolation guarantee rather than the narrowing of intent it was
before, when the driver merged `process.env` unconditionally. Nothing about the
environment — and nothing about the session token, which only the driver ever
sees — appears in a tool result, in the compact snapshot or in a log line.

## The replay tools reuse the live projections

`trace.frame_at` prints the compact ref format over reconstructed screen text and
`trace.diff` returns changed rows plus changed subtrees — the same shapes
`terminal.snapshot` and `terminal.capture_since` produce. That is the point: an
agent that learned the live loop can read a replay without learning a second
format, and `diff.ts` has one implementation serving both.

Reconstruction itself is entirely `@termwright/trace`: `stateAt()` yields the
cast prefix, the viewport after every resize, and the nearest semantic record;
`renderAnsiToHtml()` replays that prefix through the same headless emulator the
HTML report uses. This package parses no asciicast and drives no terminal.

One asymmetry worth knowing: on a live session the header revision is the
*screen* revision, while a reconstructed frame has no screen-revision counter, so
it carries the *semantic* revision (0 when the recording had no tree). Refs in a
frame are `nX@<semanticRevision>` either way, which is what makes them
comparable across the two worlds.

## Trace handles are evicted, not refused

`TraceStore` keeps at most 8 archives open per session and refuses one above
128 MB. At the ceiling it closes the least recently used reader instead of
failing the call, and reports the evicted handle in the result: an agent can
always re-open a path, but it cannot recover from a server wedged on stale
readers. A handle that was evicted fails as `no-session` with a suggestion that
says so.

There is deliberately no `trace.close`. The tool surface an agent has to learn
stays smaller, and session teardown closes every reader through
`closeSessionStores()`.

## Two stores per session

A session now owns terminals *and* trace archives (`SessionStores`). The registry
builds both and disposes both, so an HTTP `DELETE` or a dropped stdio connection
releases file handles as reliably as it kills children. `ToolContext` carries the
two stores rather than one, which is why the field is `terminals` and not
`store`.

## Screenshots

`terminal.snapshot { variant: "full" }` writes the complete dump — text, ANSI and
`screen.html()` — to `<tmp>/termwright-mcp/<session>/<terminal>/snapshot-N.json`
and returns only refs plus the path. That is the whole picture story for 1.0.

`trace.frame_at` and `trace.diff` accept `screenshot: true` and fail it with
`unsupported-action` naming `@termwright/screenshot` (task #18, in flight). The
flag is rejected rather than ignored on purpose: an agent must never believe it
received an image it did not get. When the package lands, the two call sites in
`trace-tools.ts: rejectScreenshot()` become the render call, and `ImageContent`
joins the existing text content — no schema change for the callers.

## Session ownership

`SessionRegistry` maps a session key (`stdio`, `in-memory`, or an
`Mcp-Session-Id`) to a `TerminalStore` plus whatever the transport needs. The
transports never hold session state themselves, which is what makes stdio and
Streamable HTTP interchangeable and keeps the ceilings in one place.

Per-terminal history for `capture_since` is a 16-entry ring of
`{ revision, semanticRevision, rows, semantic }`. Nothing else is retained, and a
cursor that fell out of the ring fails with `history-truncated` listing the
cursors that are still valid.
