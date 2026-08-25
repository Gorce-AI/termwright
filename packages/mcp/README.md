# @termwright/mcp

An MCP server that lets an agent drive terminal programs the way a person
would: launch a real pseudo-terminal, read a compact accessibility-style
snapshot, click a button by its ref, wait on a condition, and ask what changed.

It is deliberately thin. Every tool validates its arguments with zod, calls the
public `@termwright/driver` API, and renders the result. There is no locator
engine, no wait loop and no matching heuristic here — a behaviour that differed
between this server and the Native Host would be a bug in this package.

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
dialog "Permission" ref=semantic:n7@42 bounds=(8,20,40,9) modal
  button "Approve" ref=semantic:n8@42 bounds=(14,23,11,1) focused
visible text:
…

// terminal.click        { "terminal": "t1", "ref": "semantic:n8@42" }
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

<!-- BEGIN GENERATED MCP TOOL SURFACE -->
<!-- Generated from packages/mcp/src/registry.ts; do not edit this block by hand. -->
### Live terminal tools

| Tool | Purpose |
| --- | --- |
| `terminal.launch` | Starts a program in a real pseudo-terminal and returns a terminal handle plus the first snapshot. The child gets a minimal environment unless envMode is "inherit"; values passed in env are never echoed back. |
| `terminal.capabilities` | What this session supports: whether a semantic tree is published, which adapter publishes it, and the terminal geometry. Call it before relying on role-based targeting. |
| `terminal.snapshot` | One typed view of the terminal: compact semantic refs, visible text, cursor, terminal modes and scroll position. variant "full" writes the complete dump (text, ANSI, HTML, semantic tree) to disk and returns only refs plus the file path. The returned revision is the cursor for terminal.capture_since. |
| `terminal.capture_since` | Incremental view: the screen rows that differ and the semantic subtrees that were added, removed or updated since the given cursor. The cursor must be a revision this server handed out earlier (snapshot or capture_since); older cursors fail with history-truncated. |
| `terminal.query` | Resolves a target to refs without acting on it. Use it to check how many nodes a locator matches before clicking, or to turn a role/name into a ref. |
| `terminal.checkpoint` | Returns the atomic session/contract/screen/semantic identity used by revision-safe actions and waits. |
| `terminal.actionability` | Runs the same ActionPlanner used by execution, but sends no input. Reports every authoritative requirement and the chosen strategy or typed rejection. |
| `terminal.click` | Sends a real click mouse report through the pseudo-terminal. Fails closed with input-mode-disabled when the required tracking mode or encoding is disabled or unobservable. |
| `terminal.double_click` | Sends a real double-click mouse report through the pseudo-terminal. Fails closed with input-mode-disabled when the required tracking mode or encoding is disabled or unobservable. |
| `terminal.hover` | Sends a real motion mouse report through the pseudo-terminal. Fails closed with input-mode-disabled when the required tracking mode or encoding is disabled or unobservable. |
| `terminal.press` | Sends key chords as real bytes, honouring the modes the program enabled (application cursor keys, keypad). Examples: "Enter", "Escape", "Control+K Control+U". With a target, the node must already be focused. |
| `terminal.type` | Types text as individual keystrokes (not a paste). With a target, the node must already be focused; use terminal.fill for focus + replacement. |
| `terminal.fill` | Ensures the semantic control receives focus through the real input path, selects its current value, and types the replacement. |
| `terminal.check` | Uses the central action planner and real terminal input to check a checkbox or radio, then verifies semantic state. |
| `terminal.uncheck` | Uses the central action planner and real terminal input to uncheck a checkbox or radio, then verifies semantic state. |
| `terminal.paste` | Pastes text, wrapped in bracketed-paste markers when the program enabled that mode. Use it for multi-line input instead of terminal.type. |
| `terminal.write_raw` | Writes bytes to the pseudo-terminal verbatim — no newline, no key encoding. The escape hatch for sequences the key encoder does not model. |
| `terminal.drag` | Drags with real mouse reports: either from one target to another (toTarget), or between two cell positions inside the source target (from/to). |
| `terminal.wheel` | Sends wheel reports over a target. Positive deltaY scrolls down. |
| `terminal.resize` | Resizes the pseudo-terminal; the child sees a real SIGWINCH. |
| `terminal.signal` | Sends INT, TERM, KILL or HUP to the child. Destructive by design: terminal.close cleans up without signalling. |
| `terminal.scrollback` | Emulator-side history: read a line range, search it, or move the viewport. The child sees nothing — no input is sent. |
| `terminal.select_cells` | Selects a rectangle in the emulator (like a mouse selection). No input is sent. |
| `terminal.copy_selection` | Returns the text of the current selection and optionally clears it. |
| `terminal.wait_for` | Revision-driven waits — never a sleep. "text"/"title" wait for content, locator states use the driver's canonical Conditions, "quiet" explicitly waits for heuristic silence, "render" for a render after a given revision, "exit" for the child to exit. |
| `terminal.close` | Bounded physical cleanup: hangs up the pseudo-terminal and forgets the handle. Send signals explicitly with terminal.signal if the child must be killed first. |

### Trace tools

| Tool | Purpose |
| --- | --- |
| `trace.open` | Validates a .twtrace directory or zip and returns a handle plus its metadata: the recorded command, viewport, duration, exit status and whether the session published a semantic tree. Start every replay investigation here. |
| `trace.overview` | The shape of a recording: every step with its status and timing, the cast markers, the exit status, and which step failed. Use it to pick the moment worth reconstructing before calling trace.frame_at. |
| `trace.frame_at` | Rebuilds the screen at a moment — named by timeMs, stepIndex or marker — by replaying the recording into a headless emulator, and pairs it with the semantic tree of the nearest revision at or before that moment. Reads exactly like a live terminal.snapshot. |
| `trace.diff` | Reconstructs two moments of a recording and reports what moved: changed screen rows and changed semantic subtrees, in the same shape as terminal.capture_since on a live session. |

### Targeting

Targeting precedence is `ref`, `selector`, `testId`, `role` (+`name`), `label`, `text`, `screenText`.

`semanticTree: unavailable` means the program ships no integration — target physical output with `screenText`, never semantic `text` or `role`.

Names and text accept `/pattern/flags`. Locators are strict: more than one match returns
`ambiguous-locator` unless `nth` is explicit.
<!-- END GENERATED MCP TOOL SURFACE -->

## Replaying a recorded failure

A failing run leaves a `.twtrace` archive; the `trace.*` tools read it with the
same vocabulary as a live session.

```jsonc
// trace.open      { "path": "out/login.twtrace" }  -> handle tr1 + what was recorded
// trace.overview  { "traceId": "tr1" }             -> steps, markers, exit, which step failed
// trace.frame_at  { "traceId": "tr1", "stepIndex": 1 }
Terminal tr1 40x6 revision 2
semanticTree: available
dialog "Permission" ref=semantic:n1@2 modal
  button "Approve" ref=semantic:n2@2 disabled
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

A ref is `semantic:n8@42`: node id at semantic revision 42 (screen matches get
`screen:1,2,9,1@7`). Refs go straight to `harness.locatorForRef()`, so they resolve
by node *identity* — two buttons with the same name stay distinct. A producer
which promises stable identity can resolve that node again in later revisions.
Frame-local identities and grid refs remain revision-bound; take a fresh
snapshot when either becomes stale.

`terminal.snapshot` also returns a screen `revision`; pass it back as the
`cursor` of `terminal.capture_since` to get only the rows and semantic subtrees
that changed. Cursors the server never handed out fail with `history-truncated`
(the last 16 captures per terminal are retained).

Programs without a framework probe or custom semantic producer report
`semanticTree: unavailable`. There are no invented roles: target physical
output with `screenText`.

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
error stale-snapshot: ref semantic:n8@42 no longer exists at semantic revision 43
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
