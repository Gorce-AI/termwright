---
title: MCP tools
description: Exact Termwright MCP tools, targeting rules, cursors, sessions, errors, screenshots, and exit codes.
---

`@termwright/mcp` exposes structured MCP tools backed by the public driver and
trace APIs. Every tool declares input and output schemas and returns
`structuredContent`.

## Live terminal tools

`terminal.launch`, `capabilities`, `snapshot`, `capture_since`, `query`,
`click`, `double_click`, `press`, `type`, `paste`, `write_raw`, `drag`, `wheel`,
`resize`, `signal`, `scrollback`, `select_cells`, `copy_selection`, `wait_for`,
and `close`.

`terminal.launch` defaults to `envMode: "replace"`. The child receives a
minimal environment. Use `"inherit"` or explicit `env` entries only when the
program requires them.

## Trace tools

| Tool | Result |
| --- | --- |
| `trace.open` | Validate an archive and return its metadata and handle. |
| `trace.overview` | Return steps, markers, failed steps, duration, and exit state. |
| `trace.frame_at` | Reconstruct a screen and semantic revision by time, step, or marker. |
| `trace.diff` | Return changed rows and semantic subtrees between two times. |

## Targeting precedence

Targets resolve in this order:

1. `ref`
2. `selector`
3. `testId`
4. `role` and optional `name`
5. `label`
6. `text`

Names and text accept `/pattern/flags`. Locators are strict. More than one
match returns `ambiguous-locator` unless `nth` is explicit.

A semantic ref has the form `semantic:n8@42`: node identity at semantic revision 42. A
screen ref has the form `screen:1,2,9,1@7`. Stable semantic identities may resolve
at a later revision. Frame-local identities and grid refs require a fresh
snapshot after their revision becomes stale.

## Capture cursors

`terminal.snapshot` returns a screen revision. `terminal.capture_since` accepts
that revision as `cursor` and returns only changed rows and semantic subtrees.
The server retains the last 16 captures per terminal. Unknown or expired
cursors return `history-truncated`.

## Sessions and limits

HTTP sessions are keyed by `Mcp-Session-Id`. Deleting a session disposes its
terminals. The server accepts at most 16 sessions and 16 terminals per session.

## Errors

Tool failures return a stable `kind`, message, optional suggestion, bounded
candidates, and screen excerpt in `_meta["io.termwright/error"]`. Stack traces,
the child environment, and session tokens are not returned.

```text
error stale-snapshot: ref semantic:n8@42 no longer exists at semantic revision 43
suggestion: re-resolve the locator
```

## Screenshots

`terminal.snapshot` and `trace.frame_at` accept `screenshot: true`,
`screenshotScale`, and `screenshotTheme`. The result attaches PNG
`ImageContent` and reports its size and whether glyph rendering was fully
self-contained.

`terminal.snapshot {variant: "full"}` writes the complete text, ANSI, and HTML
dump to a file and returns its path.

## Generated context and exit codes

```sh
termwright-mcp agent-context
termwright-mcp usage
termwright-mcp skill --out DIR
```

| Exit code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | Assertion failed. |
| 2 | Invalid usage. |
| 3 | No session. |
| 4 | IPC failure. |
| 5 | Internal failure. |

See [Use Termwright with AI agents](../../guides/mcp/) for the task-oriented
workflow.
