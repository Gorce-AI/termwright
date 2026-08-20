# @termwright/mcp

An MCP server that lets an agent drive terminal programs the way a person
would: launch a real pseudo-terminal, read a compact accessibility-style
snapshot, click a button by its ref, wait on a condition, and ask what changed.

It is deliberately thin. Every tool validates its arguments with zod, calls the
public `@termwright/driver` API, and renders the result. There is no locator
engine, no wait loop and no matching heuristic here — a behaviour that differed
between this server and the test preset would be a bug in this package.

## Install

```sh
pnpm add -D @termwright/mcp
```

Node >= 22, ESM only.

## Usage

Register the binary with your MCP host (stdio is what hosts spawn):

```jsonc
{
  "mcpServers": {
    "termwright": { "command": "termwright-mcp" }
  }
}
```

A typical agent loop:

```ts
import { serveStdio } from '@termwright/mcp';

const running = await serveStdio();       // stdio, one implicit session
process.on('SIGINT', () => void running.close());
```

```jsonc
// terminal.launch  -> { terminal: "t1", semanticTree: "available", compact: … }
// envMode defaults to "replace": the child gets a minimal environment, not the
// operator's secrets. Pass "inherit" (or name variables in env) when it needs more.
{ "command": ["node", "app.js"], "columns": 100, "rows": 30 }

// terminal.snapshot -> the compact format, plus refs / cursor / modes / scroll
Terminal t1 100x30 revision 42
semanticTree: available
dialog "Permission" ref=n7@42 bounds=(8,20,40,9) modal
  button "Approve" ref=n8@42 bounds=(14,23,11,1) focused
visible text:
…

// terminal.click        { "terminal": "t1", "ref": "n8@42" }
// terminal.wait_for     { "terminal": "t1", "wait": "text", "text": "Approved" }
// terminal.capture_since{ "terminal": "t1", "cursor": 42 }  -> changed rows + subtrees
// terminal.close        { "terminal": "t1" }
```

Streamable HTTP, for hosts that connect over a socket:

```sh
termwright-mcp --http --port 7333    # endpoint: http://127.0.0.1:7333/mcp
```

Sessions are keyed by `Mcp-Session-Id` in this package's own `SessionRegistry`,
not inside transport objects: each session owns its terminals, `DELETE` disposes
them, and the ceiling (16 sessions, 16 terminals each) is enforced before a
transport exists.

Streamable HTTP gives no disconnect signal, so a session also expires after
`idleTtlMs` without a request (10 minutes by default, `0` to disable). Every
request naming a session refreshes it; expiry runs the full teardown — terminals
closed, children gone, traces released, slot returned — and writes a line to
stderr. stdio has no TTL: there, EOF on the pipe is the signal.

## Tools

`terminal.launch`, `capabilities`, `snapshot`, `capture_since`, `query`,
`click`, `double_click`, `press`, `type`, `paste`, `write_raw`, `drag`, `wheel`,
`resize`, `signal`, `scrollback`, `select_cells`, `copy_selection`, `wait_for`,
`close` — the surface CONTRACTS.md §MCP defines — plus `trace.open`,
`trace.overview`, `trace.frame_at` and `trace.diff` for recorded sessions. Every
one carries an `inputSchema` and an `outputSchema` and returns
`structuredContent`.

Targeting, in precedence order: `ref`, `selector` (the CSS dialect
`dialog button#approve:focused`), `testId`, `role` (+ `name`), `label`, `text`.
Any name or text may be written as `/pattern/flags` to match as a regular
expression. Locators are strict: more than one match fails with
`ambiguous-locator` unless you pass `nth`.

## Replaying a recorded failure

A failing run leaves a `.twtrace` archive; the `trace.*` tools read it with the
same vocabulary as a live session.

```jsonc
// trace.open      { "path": "out/login.twtrace" }  -> handle tr1 + what was recorded
// trace.overview  { "traceId": "tr1" }             -> steps, markers, exit, which step failed
// trace.frame_at  { "traceId": "tr1", "stepIndex": 1 }
Terminal tr1 40x6 revision 2
semanticTree: available
dialog "Permission" ref=n1@2 modal
  button "Approve" ref=n2@2 disabled
visible text:
…
// trace.diff      { "traceId": "tr1", "fromMs": 0, "toMs": 3000 }  -> changed rows + subtrees
```

Reconstruction is `@termwright/trace`'s: `stateAt()` returns the cast prefix and
the nearest semantic snapshot, and the prefix is replayed through the same
headless emulator the HTML report uses. A moment is named by `timeMs`,
`stepIndex` or `marker` — exactly one of them.

Archives are per session, capped at 8 open and 128 MB each; at the ceiling the
coldest handle is closed and named in the result, and re-opening a path always
works.

## Screenshots

`terminal.snapshot` and `trace.frame_at` take `screenshot: true` and attach a PNG
as `ImageContent`, rendered by `@termwright/screenshot` — a cell grid becomes an
SVG with the glyph outlines embedded and resvg rasterises it, so there is no
browser in the loop and no dependency on the agent's machine having the right
font.

```jsonc
{ "terminal": "t1", "screenshot": true, "screenshotScale": 2, "screenshotTheme": "light" }
```

The image is always *additional*: the compact tree and the screen text are in the
same result, so an agent that cannot see pictures loses nothing.
`structuredContent.screenshot` carries the size and `selfContained` — false when
a character had no embedded outline and fell back to a font the viewer may not
have. PNGs above 3 MB are refused with `capacity` rather than blowing a context
window; lower `screenshotScale` or resize the terminal.

## Refs and revisions

A ref is `n8@42`: node id at semantic revision 42 (grid matches get
`grid:1,2,9,1@7`). Refs go straight to `harness.locatorForRef()`, so they resolve
by node *identity* — two buttons with the same name stay distinct. A producer
which promises stable identity can resolve that node again in later revisions.
Frame-local identities and grid refs remain revision-bound; take a fresh
snapshot when either becomes stale.

`terminal.snapshot` also returns a screen `revision`; pass it back as the
`cursor` of `terminal.capture_since` to get only the rows and semantic subtrees
that changed. Cursors the server never handed out fail with `history-truncated`
(the last 16 captures per terminal are retained).

Programs without a framework probe or custom semantic producer report
`semanticTree: unavailable`. There are no invented roles: target them by text.

## Application logs

A terminal shows what a program drew; its log says what it decided. Follow one
at launch and read it alongside the screen:

```jsonc
// terminal.launch
{ "command": ["node", "app.js"], "logs": [{ "path": "out/app.log", "label": "app" }] }

// terminal.capture_since -> changed rows, changed subtrees, and:
logs: 2
  1840ms [app] ERROR upstream refused the token
  1841ms [app] WARN falling back to cached profile
```

An existing file is followed from its end, so a session never replays the
previous run. Entries are buffered per terminal (1000 deep) and returned since
your cursor, with `logsOmitted` counting anything that fell out in between —
computed when you read, so a program that went quiet still reports its last
drops. Files are polled, so a line written moments ago may arrive on the next
call; re-asking with the same cursor is lossless.

Structured records from an instrumented adapter keep their level, logger and
attributes; a followed file yields the raw line.

The same view exists for a recording: `trace.frame_at` returns the entries
leading up to that moment (`maxLogs`, default 20) and `trace.diff` the ones
between the two, so "what was it saying when the screen looked like this" reads
the same live and in replay.

## Crashes

When a child dies on its own, the driver records what the session knew and this
server surfaces it three ways: attached to whatever call failed next,
in `terminal.capabilities` and `terminal.snapshot` instead of a bare closed
session, and in `trace.overview` for a recording whose `meta.json` carries one.

```
crash: the program exited on its own — code=7 signal=null at 812ms
last input: key "\r"
screen tail:
Error: boom
  at thing (app.js:3:9)
```

That matters because a locator which never resolved because the program is gone
otherwise reports a plain `timeout`, and an agent reading a timeout waits longer.

In a recording, `crash.timeMs` is the cast offset, so
`trace.frame_at { traceId, timeMs }` jumps to the moment of death with the screen
and the semantic tree of that revision.

The screen tail is **unredacted** — it is what the terminal displayed, secrets
included. It is bounded (40 lines, 500 characters each) and never logged, but
treat it like a screenshot when storing or forwarding a result. Paste contents
are the one thing never recorded: the driver keeps their size only.

## Errors

Failures come back as tool results with `isError` set. The text content reads

```
error stale-snapshot: ref n8@42 no longer exists at semantic revision 43
suggestion: re-resolve the locator; the node identity is no longer present
semanticTree: true
```

and the same payload — `kind`, `message`, `suggestion`, bounded `candidates`,
`screenExcerpt` — travels structured in `_meta["io.termwright/error"]`. Stack
traces never leave the server, and neither the child's environment nor the
session token appears in any result or log.

## CLI

```sh
termwright-mcp                 # serve over stdio
termwright-mcp --http --port N # serve Streamable HTTP on /mcp
termwright-mcp agent-context   # versioned JSON: every tool, param, enum, exit code
termwright-mcp usage           # one-screen cheat sheet
termwright-mcp skill --out DIR # emit an agent-skill package (SKILL.md + reference)
termwright-mcp --json …        # machine-readable errors carrying `kind`
```

Exit codes: 0 ok / 1 assertion / 2 usage / 3 no-session / 4 ipc / 5 internal.

`agent-context` and the `skill` package are generated from the live zod schemas,
so neither can drift from the tools. `skill` writes `SKILL.md` (what an agent
reads), `reference.md` (every tool and parameter) and `agent-context.json`; with
no `--out` it prints them instead. The umbrella `termwright` CLI imports
`buildAgentContext()`, `buildUsage()` and `buildAgentSkill()` rather than
spawning this binary.

## Testing this package

```sh
pnpm build && pnpm typecheck && pnpm test
```

The end-to-end suite runs a real MCP client over `InMemoryTransport` against the
real driver and the fixtures in `packages/driver/test-fixtures`. It skips itself
where no pseudo-terminal can be opened, or with `TERMWRIGHT_SKIP_PTY=1`.
