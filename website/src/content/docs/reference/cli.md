---
title: CLI and exit codes
description: The command-line surface, the machine-readable error contract, and the exit-code taxonomy an agent can branch on.
---

## The exit-code taxonomy

Normative, closed, and the same for every termwright binary. An agent or a CI
script can branch on it without parsing prose:

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | assertion failed |
| 2 | usage error |
| 3 | no session |
| 4 | ipc failure |
| 5 | internal error |

`--json` is global. Errors carry a `kind` field holding the same taxonomy the
library uses (`timeout`, `stale-snapshot`, `ambiguous-locator`,
`unsupported-action`, `history-truncated`, `protocol-violation`, `capacity`,
`process-exited`, `session-closed`), plus a `suggestion` and bounded
`candidates`.

## `termwright-mcp`

Ships with `@termwright/mcp` and is what an MCP host spawns.

```sh
termwright-mcp                 # serve over stdio
termwright-mcp --http --port N # serve Streamable HTTP on /mcp
termwright-mcp agent-context   # versioned JSON: every tool, param, enum, exit code
termwright-mcp usage           # one-screen cheat sheet
termwright-mcp skill --out DIR # emit an agent-skill package
termwright-mcp --json …        # machine-readable errors carrying `kind`
```

`agent-context` and the skill package are generated from the live zod schemas,
so neither can drift from the tools. `skill` writes `SKILL.md` (what an agent
reads), `reference.md` (every tool and parameter) and `agent-context.json`; with
no `--out` it prints them instead of writing files.

See the [MCP guide](../../guides/mcp/) for the tool surface itself.

## `termwright`

The umbrella package re-exports the common surface and carries the CLI —
including `termwright ui` (live runner, `.twtrace` viewer, recorder) and
`termwright codegen`, which generates a test from what you do in a real
terminal. It imports the agent-surface builders from `@termwright/mcp` rather
than spawning that binary, so `agent-context` and `usage` produce identical
output from either entry point.

:::note[Command reference pending]
The umbrella CLI is being finalised. Its flags will be documented here from the
generated `agent-context` — the same source the binary itself uses — rather than
transcribed by hand, so the reference cannot drift from the implementation. The
exit-code taxonomy and the `--json` error contract above are already fixed by
the contract and will not change.
:::

## Programmatic equivalents

Everything the CLI does is available as a library call, which is usually what
you want in CI:

```ts
import {startUiServer} from '@termwright/ui';
import {generateHtmlReport, openTrace, packTrace} from '@termwright/trace';
import {serveStdio} from '@termwright/mcp';
```
