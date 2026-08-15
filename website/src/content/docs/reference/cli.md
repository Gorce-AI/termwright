---
title: CLI and exit codes
description: The termwright command line, the umbrella package's imports, and the exit-code taxonomy an agent can branch on.
---

## Install

```sh
npm install --save-dev termwright
```

The umbrella package carries the CLI and re-exports the surface most projects
need, so a test file needs one import rather than three:

| Import | What it gives you |
|---|---|
| `termwright` | the driver's public API (`launchTerminal`, `TermwrightError`, the types) |
| `termwright/test` | the Vitest preset — `test`, `expect`, the `terminal` fixture, the matchers |
| `termwright/ink` | `mountInk` and `launchInkFixture` |
| `termwright/cli` | the CLI as a library, for scripts that wrap it |

Importing `termwright/test` registers the matchers on `expect` as a side effect,
which is exactly why it is a separate entry point — see
[Configuration](../configuration/) for the `vitest.config.ts` caveat about the
reporter.

The individual packages (`@termwright/driver`, `@termwright/test`, …) stay
installable on their own; the umbrella is a convenience, not a requirement.

## Commands

```
termwright ui [--trace <file>] [--port N] [--host H] [--no-watch] [-- <vitest args>]
termwright ui --record [--out-file <file>] -- <command>
termwright codegen [--out-file <file>] -- <command>
termwright mcp [--http] [--port N]
termwright agent-context | usage | skill [--out <dir>]
```

| Command | What it does |
|---|---|
| `ui` | opens the [runner](../../guides/runner-ui/): live terminal, semantic inspector, timeline. With no flags it starts Vitest in watch mode and points it at the runner; `--trace` opens a `.twtrace` archive instead; `--record` drives a program you name and writes the test. |
| `codegen` | `ui --record`, for when recording is the whole point. |
| `mcp` | serves the [MCP tools](../../guides/mcp/); every argument is forwarded to `@termwright/mcp` untouched. |
| `agent-context` | versioned JSON describing every tool, parameter and exit code. |
| `usage` | the one-screen cheat sheet. |
| `skill` | an agent-skill package: `SKILL.md`, `reference.md`, `agent-context.json`. |

Global flags: `--json` (machine-readable output; errors carry `kind`),
`--version` / `-v`, `--help` / `-h`.

`agent-context`, `usage` and `skill` are generated from the live zod schemas, so
they cannot drift from the tools they describe. The umbrella imports those
builders from `@termwright/mcp` rather than spawning its binary, so
`termwright agent-context` and `termwright-mcp agent-context` produce identical
output.

## Exit codes

Normative, closed, and the same for every termwright binary — an agent or a CI
script can branch on it without parsing prose:

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | assertion failed |
| 2 | usage error |
| 3 | no session |
| 4 | ipc failure |
| 5 | internal error |

A failing test run reported through `termwright ui` exits **1**, not 5: the
runner's own failures are assertion failures, not CLI faults.

`--json` errors carry a `kind` field holding the same taxonomy the library uses
(`timeout`, `stale-snapshot`, `ambiguous-locator`, `unsupported-action`,
`history-truncated`, `protocol-violation`, `capacity`, `process-exited`,
`session-closed`), plus a `suggestion` and bounded `candidates`.

## `termwright-mcp`

Shipped by `@termwright/mcp` and what an MCP host spawns directly:

```sh
termwright-mcp                 # serve over stdio
termwright-mcp --http --port N # serve Streamable HTTP on /mcp
termwright-mcp agent-context   # versioned JSON
termwright-mcp usage           # one-screen cheat sheet
termwright-mcp skill --out DIR # emit an agent-skill package
```

`termwright mcp …` forwards to the same server, so either entry point works in
an MCP host configuration.

## Programmatic equivalents

Everything the CLI does is a library call, which is usually what you want in CI:

```ts
import {startUiServer} from '@termwright/ui';
import {generateHtmlReport, openTrace, packTrace} from '@termwright/trace';
import {serveStdio} from '@termwright/mcp';
```
