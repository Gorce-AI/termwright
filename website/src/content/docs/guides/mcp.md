---
title: MCP for agents
description: An MCP server over the same driver — compact ref snapshots, incremental capture, generated agent-context, and an exit-code taxonomy.
---

`@termwright/mcp` lets an agent drive terminal programs the way a person would:
launch a real pseudo-terminal, read a compact accessibility-style snapshot, click
a button by its ref, wait on a condition, and ask what changed.

It is deliberately thin. Every tool validates its arguments with zod, calls the
public driver API, and renders the result. There is no locator engine, no wait
loop and no matching heuristic in it — a behaviour that differed between this
server and the test preset would be a bug in this package.

## Registering it

```jsonc
{
  "mcpServers": {
    "termwright": {"command": "termwright-mcp"}
  }
}
```

For hosts that connect over a socket:

```sh
termwright-mcp --http --port 7333    # endpoint: http://127.0.0.1:7333/mcp
```

Sessions are keyed by `Mcp-Session-Id` in the server's own registry, not inside
transport objects: each session owns its terminals, `DELETE` disposes them, and
the ceiling (16 sessions, 16 terminals each) is enforced before a transport
exists.

## The loop

```jsonc
// terminal.launch  -> { terminal: "t1", semanticTree: "available", compact: … }
{"command": ["node", "app.js"], "columns": 100, "rows": 30}
```

```
// terminal.snapshot
Terminal t1 100x30 revision 42
semanticTree: available
dialog "Permission" ref=n7@42 bounds=(8,20,40,9) modal
  button "Approve" ref=n8@42 bounds=(14,23,11,1) focused
visible text:
…
```

```jsonc
// terminal.click         {"terminal": "t1", "ref": "n8@42"}
// terminal.wait_for      {"terminal": "t1", "wait": "text", "text": "Approved"}
// terminal.capture_since {"terminal": "t1", "cursor": 42}
// terminal.close         {"terminal": "t1"}
```

`terminal.launch` defaults to `envMode: "replace"`: the child gets a minimal
environment, not the operator's secrets. Pass `"inherit"` (or name variables in
`env`) when it genuinely needs more.

## Incremental capture

`terminal.snapshot` returns a screen `revision`. Pass it back as the `cursor` of
`terminal.capture_since` and you get only the rows **and semantic subtrees** that
changed — the difference between an agent re-reading a 30-row screen every turn
and reading the one line that moved.

Cursors the server never handed out fail with `history-truncated`; the last 16
captures per terminal are retained.

## Refs

A ref is `n8@42`: node id at semantic revision 42 (grid matches get
`grid:1,2,9,1@7`). Refs resolve by node *identity*, so two buttons with the same
name stay distinct, and a ref reused after its revision was superseded fails with
`stale-snapshot`. The fix is always to snapshot again.

Targeting, in precedence order: `ref`, `selector` (the CSS dialect
`dialog button#approve:focused`), `testId`, `role` (+ `name`), `label`, `text`.
Any name or text may be written as `/pattern/flags`. Locators are strict: more
than one match fails with `ambiguous-locator` unless you pass `nth`.

Programs without an adapter report `semanticTree: unavailable`. There are no
invented roles — target them by text.

## Tools

`terminal.launch`, `capabilities`, `snapshot`, `capture_since`, `query`, `click`,
`double_click`, `press`, `type`, `paste`, `write_raw`, `drag`, `wheel`, `resize`,
`signal`, `scrollback`, `select_cells`, `copy_selection`, `wait_for`, `close`.

Every one carries an `inputSchema` and an `outputSchema` and returns
`structuredContent`.

## Errors an agent can act on

```
error stale-snapshot: ref n8@42 was minted at semantic revision 42; the live revision is 43
suggestion: call terminal.snapshot or terminal.capture_since and use the fresh refs
semanticTree: true
```

The same payload — `kind`, `message`, `suggestion`, bounded `candidates`,
`screenExcerpt` — travels structured in `_meta["io.termwright/error"]`. Stack
traces never leave the server, and neither the child's environment nor the
session token appears in any result or log.

## Self-describing surface

```sh
termwright-mcp agent-context   # versioned JSON: every tool, param, enum, exit code
termwright-mcp usage           # one-screen cheat sheet
termwright-mcp skill --out DIR # an agent-skill package (SKILL.md + reference)
termwright-mcp --json …        # machine-readable errors carrying `kind`
```

`agent-context` and the skill package are generated from the live zod schemas,
so neither can drift from the tools. `skill` writes `SKILL.md` (what an agent
reads), `reference.md` (every tool and parameter) and `agent-context.json`; with
no `--out` it prints them.

Exit codes are a closed taxonomy an agent can branch on:

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | assertion failed |
| 2 | usage error |
| 3 | no session |
| 4 | ipc failure |
| 5 | internal error |

## Replaying a trace

An agent does not only drive live terminals: the most useful thing to hand it
after a CI failure is the [recording](../traces/). Four read-only tools open a
`.twtrace` archive and read it the same way a live session is read.

```jsonc
// trace.open       {"path": "artifacts/login.twtrace"}  -> { traceId: "tr1", meta, steps }
// trace.overview   {"traceId": "tr1"}                   -> steps, markers, failedSteps, exit
// trace.frame_at   {"traceId": "tr1", "stepIndex": 2}   -> the screen and tree at that moment
// trace.diff       {"traceId": "tr1", "fromMs": 800, "toMs": 1400}
```

- **`trace.open`** validates the archive and returns a handle plus the recorded
  command, viewport, duration, exit status, and whether the session published a
  semantic tree. Every replay investigation starts here.
- **`trace.overview`** is the shape of the recording: each step with status and
  timing, the cast markers, which step failed. This is how an agent picks the
  moment worth reconstructing instead of scanning the whole session.
- **`trace.frame_at`** rebuilds the screen at a moment — named by `timeMs`,
  `stepIndex` or `marker` — by replaying the recording into a headless emulator,
  and pairs it with the semantic tree of the nearest revision at or before it.
  The result reads exactly like a live `terminal.snapshot`, refs included.
- **`trace.diff`** reconstructs two moments and reports what moved: changed rows
  and changed semantic subtrees, in the same shape as `capture_since` on a live
  session.

Because the output shapes match the live tools, an agent needs no second mental
model for post-mortems — the same "snapshot, find the ref, ask what changed"
loop works on a recording from a machine it has never seen.

## Screenshots

`terminal.snapshot {variant: "full"}` writes the complete dump — text, ANSI and
the HTML rendering — to a file under the system temporary directory and returns
only refs plus the path.

No tool returns `ImageContent` yet. `trace.frame_at` and `trace.diff` accept a
`screenshot` flag, and passing it today fails with `unsupported-action` and says
why rather than silently ignoring it.

The renderer itself now exists — [`@termwright/screenshot`](../traces/) produces
SVG with embedded glyph outlines and PNG through resvg, with no browser
involved — so what remains is wiring it into these tools. Until that lands, an
agent gets the reconstructed screen text and the compact tree, which is what it
can actually reason over anyway.
