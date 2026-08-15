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

## Tools

`terminal.launch`, `capabilities`, `snapshot`, `capture_since`, `query`,
`click`, `double_click`, `press`, `type`, `paste`, `write_raw`, `drag`, `wheel`,
`resize`, `signal`, `scrollback`, `select_cells`, `copy_selection`, `wait_for`,
`close` — the surface CONTRACTS.md §MCP defines. Every one carries an
`inputSchema` and an `outputSchema` and returns `structuredContent`.

Targeting, in precedence order: `ref`, `selector` (the CSS dialect
`dialog button#approve:focused`), `testId`, `role` (+ `name`), `label`, `text`.
Any name or text may be written as `/pattern/flags` to match as a regular
expression. Locators are strict: more than one match fails with
`ambiguous-locator` unless you pass `nth`.

## Refs and revisions

A ref is `n8@42`: node id at semantic revision 42. It is valid only while 42 is
the live semantic revision — reuse after the screen moved on fails with
`stale-snapshot`, exactly as in the driver, and the fix is to snapshot again.

`terminal.snapshot` also returns a screen `revision`; pass it back as the
`cursor` of `terminal.capture_since` to get only the rows and semantic subtrees
that changed. Cursors the server never handed out fail with `history-truncated`
(the last 16 captures per terminal are retained).

Programs without a termwright adapter report `semanticTree: unavailable`. There
are no invented roles: target them by text.

## Errors

Failures come back as tool results with `isError` set. The text content reads

```
error stale-snapshot: ref n8@42 was minted at semantic revision 42; the live revision is 43
suggestion: call terminal.snapshot or terminal.capture_since and use the fresh refs
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
