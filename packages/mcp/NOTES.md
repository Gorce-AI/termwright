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
`capability-unavailable`, `not-actionable` and `stale-snapshot` with the driver's own suggestion. The
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

`tools.ts: settleSemantics()` therefore calls the public `waitForQuiet()` before
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

## `diff.ts` stays local, now that `@termwright/trace` is a dependency

The dependency rule that once forced this (mcp could not reach trace) is gone —
the replay tools import the trace reader. `diff.ts` stays anyway, because trace's
`diffSemanticSnapshots` answers a different question: it reports every changed
node for the HTML report, while an agent needs the *minimal changed subtree
roots* rendered in the compact ref format and capped for a context window. One
implementation now serves both the live `capture_since` and `trace.diff`, which
is what keeps those two tools reading identically.

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

## The `skill` package is generated, not written

`agent-skill.ts` renders `SKILL.md`, `reference.md` and `agent-context.json` from
the same zod schemas the tools register, so a parameter that changes changes the
distributed skill in the same commit. The prose in `SKILL.md` is the only
hand-written part, and it is deliberately short: what the loop is, how to read a
snapshot, which revision is which, what to do per error kind, and how a replay
investigation runs.

## Screenshots

`terminal.snapshot` and `trace.frame_at` accept `screenshot: true` and attach a
PNG as `ImageContent`. `@termwright/screenshot` does the rendering; this package
only decides when an image is worth sending (`screenshots.ts`).

Both worlds feed the renderer the same shape. A live `harness.screen()` is
already a `ScreenFrame`, and `frameFromAnsi()` from `@termwright/trace` gives one
for a recorded moment — which is why `trace.frame_at` now reconstructs through
that instead of `renderAnsiToHtml`: one call yields the cell grid for the picture
*and* the text for the compact snapshot, rather than replaying the recording
twice into two different representations.

Three deliberate choices:

- the image never replaces text. Both go in the same result, so an agent with no
  vision loses nothing by the flag being on, and a screenshot is never the only
  place an answer lives;
- `structuredContent.screenshot` reports size plus `selfContained`. A `false`
  there means some character fell back to `<text>` and will only render where a
  suitable font exists — worth knowing before an agent concludes anything from
  pixels;
- PNGs above 3 MB fail with `capacity`. Base64 inflates a result by a third, and
  an image that large is likelier to blow a context window than to answer a
  question. `SCREENSHOT_LIMITS` in `screenshots.ts` holds the ceiling.

`trace.diff` deliberately has no screenshot flag: it spans two moments, and an
image of "the difference" would be an invention. Ask for the two frames.

## The log cursor is a sequence, not a timestamp

`capture_since` anchors logs to the log sequence number recorded in the baseline
capture, not to wall-clock time. Two properties follow, both of which an agent
depends on: re-asking with the same cursor returns the same window plus whatever
arrived since (so a polled file that lands late is never lost), and the screen
view and the log view of "since the cursor" describe the same interval.

`LogBuffer.since()` computes `omitted` **at read time** from sequence numbers,
rather than accumulating a counter as entries are evicted. The driver flagged
this pattern: a counter that is only published with the next event silently
loses the final window — which is precisely the case where a program went quiet
because it died, and the count matters most. Here, `omitted` is
`(oldest retained seq - 1) - cursor` plus whatever the response ceiling trimmed,
so it is correct even if nothing ever arrives again.

Reads do not wait for the log tail the way they wait for semantic pairing
(`settleSemantics`). A pairing that has not landed makes the *same* revision
inconsistent, while a log line is an independent event: taxing every call with a
poll interval to catch one that may not exist buys less than it costs, and the
next capture picks it up without loss.

## Live and archived logs meet in one projection

`logs.ts` owns the entry shape and the renderer; the live side fills it from
`app-log` events, the replay side from `@termwright/trace`'s `TraceLogEntry`
(`fromTraceLog`). An archived entry has no arrival sequence of its own for a
followed file, so its position in the stream stands in, and its `timeMs` is the
cast offset — the timeline the replay tools already speak, as with crashes.

`trace.frame_at` takes the window the reader already computes (`stateAt`'s
`logWindow`), while `trace.diff` streams `logs()` and keeps what falls strictly
inside the two cast offsets. Both are clamped to the recording, so a window that
runs past the end simply stops there — a test pins that, because the alternative
(silently reporting entries from beyond the frames being compared) would make a
diff describe something it did not show.

## Crash reporting happens in one place

`server.ts: withCrashContext()` attaches the crash to *any* failed tool call
whose arguments name a terminal whose child died. Doing it there rather than in
each acting tool means one code path instead of fifteen, and the server is the
only layer that sees both the raw arguments and every thrown error. The
underlying failure keeps its own kind — a `timeout` stays a `timeout` — with the
crash alongside, because rewriting the kind would hide which call actually
failed.

The success paths are separate: `terminal.capabilities` and `terminal.snapshot`
read `crashReport()` directly, since nothing throws when you inspect a session
whose program has already exited. Without that, the honest-but-useless answer to
"what is going on" is a session that simply reports itself closed.

`crash.ts` bounds the report (40 tail lines, 500 characters each, 10 inputs, 10
diagnostics) and marks the tail as sensitive in the schema description, in the
README and in `SKILL.md`. The driver already omits previews for pastes, which
routinely carry secrets; everything else in the tail is verbatim, so the only
honest thing to do is tell the agent it is holding something screenshot-shaped.

`trace.overview` reads `meta.crash` structurally (`crashOfMeta()`), so it works
before and after `@termwright/trace` types the field — a malformed section is
ignored rather than failing the call. Format agreed with that package's owner:
the driver's `CrashReport` minus the semantic tree, which already lives verbatim
in `semantics.jsonl`, plus `lastSemanticRevision` to reach it.

## Idle TTL, because HTTP never says goodbye

A Streamable HTTP client that crashes, is killed, or simply walks away leaves
nothing behind to notice: no close frame, no EOF, no event. Its session stays
registered, its terminals keep running, their children keep running, and its
slot stays taken. Enough repeats and an agent that crash-loops has quietly
denial-of-serviced the operator's own machine — which is how conformance found
this (#27d).

Idleness is therefore the only liveness signal available, and `SessionRegistry`
treats it as one: every request naming a session calls `touch()`, and
`sweepIdle()` tears down anything past `idleTtlMs` (10 minutes by default). The
teardown is the full one — stores closed, transport disposed, slot freed — and
it logs to **stderr**, never stdout, which may be a protocol stream.

Two details worth keeping. The sweeper's interval is `unref`'d, so it cannot by
itself hold a process open. And the clock is injectable: the tests advance a
fake one to prove expiry and refresh deterministically, then one test runs on the
real timer to prove the sweeper is actually scheduled — a fake-clock-only suite
would pass just as happily with the interval never started.

stdio gets no TTL. There, EOF on the pipe *is* the disconnect signal, and a
session that idles while its host thinks it owns a terminal is a bug, not a leak.

## Session ownership

`SessionRegistry` maps a session key (`stdio`, `in-memory`, or an
`Mcp-Session-Id`) to a `TerminalStore` plus whatever the transport needs. The
transports never hold session state themselves, which is what makes stdio and
Streamable HTTP interchangeable and keeps the ceilings in one place.

Per-terminal history for `capture_since` is a 16-entry ring of
`{ revision, semanticRevision, rows, semantic }`. Nothing else is retained, and a
cursor that fell out of the ring fails with `history-truncated` listing the
cursors that are still valid.
