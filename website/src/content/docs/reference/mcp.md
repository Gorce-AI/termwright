---
title: MCP tools
description: Exact Termwright MCP tools, targeting rules, cursors, sessions, errors, screenshots, and exit codes.
---

`@termwright/mcp` exposes structured MCP tools backed by the public driver and
trace APIs. Every tool declares input and output schemas and returns
`structuredContent`.

## Tool surface

<!-- BEGIN GENERATED MCP TOOL SURFACE -->
<!-- Generated from packages/mcp/src/registry.ts; do not edit this block by hand. -->
### Live terminal tools

| Tool | Purpose |
| --- | --- |
| `terminal.launch` | Starts a program in a real pseudo-terminal and returns a terminal handle plus the first snapshot. The child gets a minimal environment unless envMode is "inherit"; values passed in env are never echoed back. |
| `terminal.capabilities` | What this session supports: whether a semantic tree is published, which adapter publishes it, and the terminal geometry. Call it before relying on role-based targeting. |
| `terminal.snapshot` | One typed view of the terminal: compact semantic refs, visible text, cursor, terminal modes and scroll position. variant "full" writes the complete dump (text, ANSI, HTML, semantic tree) to disk and returns only refs plus the file path. The returned revision is the cursor for terminal.capture_since. |
| `terminal.capture_since` | Incremental view: the screen rows that differ and the semantic subtrees that were added, removed or updated in the latest committed semantic tree since the given cursor. A screen change alone does not imply a future semantic commit; wait for an explicit semantic state when the caller requires one. The cursor must be a revision this server handed out earlier (snapshot or capture_since); older cursors fail with history-truncated. |
| `terminal.query` | Queries the current state without acting or waiting for a match. Zero matches return immediately. Use terminal.wait_for to await appearance, then query to inspect matches. |
| `terminal.checkpoint` | Returns the atomic session/contract/screen/semantic identity used by revision-safe actions and waits. |
| `terminal.actionability` | Runs the same ActionPlanner used by execution, but sends no input. Reports every authoritative requirement and the chosen strategy or typed rejection. |
| `terminal.click` | Sends a real click mouse report through the pseudo-terminal. Success confirms delivery of input, not completion of the application operation; use terminal.wait_for for its resulting state. Fails closed with input-mode-disabled when required tracking or encoding is disabled or unobservable. |
| `terminal.double_click` | Sends a real double-click mouse report through the pseudo-terminal. Success confirms delivery of input, not completion of the application operation; use terminal.wait_for for its resulting state. Fails closed with input-mode-disabled when required tracking or encoding is disabled or unobservable. |
| `terminal.hover` | Sends a real motion mouse report through the pseudo-terminal. Success confirms delivery of input, not completion of the application operation; use terminal.wait_for for its resulting state. Fails closed with input-mode-disabled when required tracking or encoding is disabled or unobservable. |
| `terminal.click_at` | Sends a physical mouse click at a viewport cell without claiming that a semantic control receives it. Useful for composite controls whose visible child owns the hit cell; a child may stop event propagation. Success confirms input delivery only, so verify the application result with terminal.wait_for. |
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
| `terminal.select_cells` | Selects cells in Termwright's emulator only. No mouse input reaches the application, so this cannot test application selection or Ctrl+C. Use terminal.drag followed by terminal.press and terminal.wait_for to test that flow. |
| `terminal.copy_selection` | Returns text selected in Termwright's emulator by terminal.select_cells; this does not invoke the application's copy behavior. |
| `terminal.wait_for` | Revision-driven waits — never a sleep. "text"/"title" wait for content, locator states use the driver's canonical Conditions, "quiet" explicitly waits for heuristic silence, "render" for a render after a given revision, "exit" for the child to exit. |
| `terminal.close` | Bounded physical cleanup: hangs up the pseudo-terminal, finalizes an optional recording, and forgets the handle. Send signals explicitly with terminal.signal if the child must be killed first. |

### Durable watcher tools

| Tool | Purpose |
| --- | --- |
| `watch.start` | Starts a revision-driven wait owned by the MCP session. It keeps running when the initiating request ends; use watch.wait to receive its buffered result. |
| `watch.wait` | Waits for the next buffered result. Cancelling or timing out this MCP request leaves the watcher alive; call watch.wait again with the same id. |
| `watch.cancel` | Cancels and forgets a session-owned watcher. |

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

`terminal.launch` defaults to `envMode: "replace"`. The child receives a
minimal environment. Use `"inherit"` or explicit `env` entries only when the
program requires them.

A semantic ref has the form `semantic:n8@42`: node identity at semantic revision 42. A
screen ref has the form `screen:1,2,9,1@7`. Stable semantic identities may resolve
at a later revision. Frame-local identities and grid refs require a fresh
snapshot after their revision becomes stale.

## Capture cursors

`terminal.snapshot` returns a screen revision. `terminal.capture_since` accepts
that revision as `cursor` and returns only changed rows and changes in the latest
committed semantic tree. A wait for PTY text proves visual output only; when a
semantic result matters, wait for its explicit locator state before capturing.
The server retains the last 16 captures per terminal. Unknown or expired cursors
return `history-truncated`.

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
