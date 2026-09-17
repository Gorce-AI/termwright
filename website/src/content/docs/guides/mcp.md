---
title: Use Termwright with AI agents
description: Give an agent a real terminal, structured snapshots, safe actions, and retained CI traces through MCP.
---

Use `@termwright/mcp` when an agent needs to inspect and drive a CLI or TUI. The
server exposes the same real-terminal input and observation model as the public
driver API.

## Register the MCP server

Add the executable to your agent host:

```jsonc
{
  "mcpServers": {
    "termwright": { "command": "termwright-mcp" },
  },
}
```

Hosts that require HTTP can connect to a local endpoint:

```sh
termwright-mcp --http --port 7333
```

## Launch and inspect an application

Start with `terminal.launch`, then request `terminal.snapshot`:

```jsonc
{ "command": ["node", "/workspace/app.js"], "columns": 100, "rows": 30 }
```

For an OpenTUI application, let MCP attach the installed probe instead of
constructing a runtime-specific preload path:

```jsonc
{ "command": ["bun", "src/app.ts"], "probe": "opentui" }
```

The command must start with Bun or Node. Termwright selects `--preload` or
`--import` and resolves its own matching probe entry point.

The snapshot contains the terminal screen and, when an integration is active,
a compact semantic tree with stable node references:

```text
dialog "Permission" ref=semantic:n7@42
  button "Approve" ref=semantic:n8@42 focused
```

Programs without semantics remain operable through text, keyboard input, and
screen capture. The server does not infer roles from terminal text.

## Watch the agent in a browser

Add `--monitor` to the stdio server command when you want to follow the agent's
live terminal and semantic tree:

```jsonc
{
  "mcpServers": {
    "termwright": { "command": "termwright-mcp", "args": ["--monitor"] },
  },
}
```

Starting the MCP server does not open an empty window. The first successful
`terminal.launch` starts a dedicated browser app with an isolated temporary
profile. Styled cells, colours, cursor position, and semantic state update
live. Automatic sizing keeps the real cell size when it fits and scales the
complete grid down when necessary, with the active percentage visible in the
controls. You can zoom manually, restore automatic sizing, or enter fullscreen
with only the terminal visible. Closing the final terminal stops the monitor
server, closes its browser process, and removes its profile.

Use `--monitor --no-open` to print the capability URL when the first terminal
launches without opening a browser automatically.

## Interact with the terminal

Prefer references or semantic locators when available:

```jsonc
// terminal.click
{"terminal": "t1", "ref": "semantic:n8@42"}

// terminal.wait_for
{"terminal": "t1", "wait": "text", "text": "Approved"}
```

Use `terminal.press`, `terminal.type`, and `terminal.paste` for normal keyboard
flows. Pointer actions succeed only when the framework integration can prove
the exact recipient.

## Read only what changed

`terminal.snapshot` returns a revision cursor. Pass it to
`terminal.capture_since` to receive changed screen rows and semantic subtrees
instead of another full snapshot.

Take a fresh snapshot when a frame-local or grid reference becomes stale.
Stable semantic identities can be resolved across later revisions while the
node remains present.

## Investigate a CI trace

An agent can inspect a retained `.twtrace` without launching the application:

```jsonc
// trace.open
{"path": "artifacts/login.twtrace"}

// trace.frame_at
{"traceId": "tr1", "stepIndex": 2}

// trace.diff
{"traceId": "tr1", "fromMs": 800, "toMs": 1400}
```

Use `trace.overview` first to find failed steps, crash markers, and useful
times. Live and replay snapshots use compatible output shapes.

## Generate agent context

```sh
termwright-mcp agent-context
termwright-mcp usage
termwright-mcp skill --out .agents/skills/termwright
```

These outputs are generated from the current tool schemas. For every tool,
argument, result, error payload, cursor rule, and lifecycle limit, see
[MCP tools](../../reference/mcp/).
