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
| `termwright` | the driver's public API (`launchTerminal`, locators, actions, waits, the error taxonomy) |
| `termwright/test` | the Vitest preset — `test`, `expect`, the `terminal` fixture, the matchers, YAML snapshots |
| `termwright/ink` | `mountInk` and `launchInkFixture` |
| `termwright/reporter` | the trace reporter, for `vitest.config.ts` |
| `termwright/ui-reporter` | the runner's live bridge, for `vitest.config.ts` |
| `termwright/cli` | the CLI as a library, for scripts that wrap it |

Everything a project needs is reachable from this one package, config included,
so `termwright` in `devDependencies` is the whole install:

```ts
// vitest.config.ts
import {defineConfig} from 'vitest/config';
import TermwrightReporter from 'termwright/reporter';
import TermwrightUiReporter from 'termwright/ui-reporter';

export default defineConfig({
  test: {reporters: ['default', new TermwrightReporter(), new TermwrightUiReporter()]},
});
```

The two reporters are independent and compose: one writes `.twtrace` archives,
the other streams a live run to `termwright ui`. The UI one does nothing when
`TERMWRIGHT_UI_URL` is unset, so it is safe to leave configured in a repository
whose runs are mostly headless.

The reporters have their own entry points because `vitest.config.ts` is loaded
before the test runner exists, while `termwright/test` registers matchers on
`expect` as a side effect. The individual packages
(`@termwright/driver`, `@termwright/test`, …) stay installable on their own; the
umbrella is a convenience, not a requirement.

`termwright` itself has no test-runner dependency, so a plain script or a
`node:test` file can use it:

```ts
import {launchTerminal} from 'termwright';

const app = await launchTerminal({command: ['htop']});
await app.waitForText('CPU');
console.log(app.screen().text());
await app.close();
```

## Commands

```
termwright ui [--trace <file>] [--port N] [--host H] [--no-watch] [--no-open] [-- <vitest args>]
termwright ui --record [--out-file <file>] -- <command>
termwright report --trace <file> [--out-file <file>]
termwright codegen [--out-file <file>] -- <command>
termwright mcp [--http] [--port N]
termwright agent-context | usage | skill [--out <dir>]
```

| Command | What it does |
|---|---|
| `ui` | opens the [runner](../../guides/runner-ui/): live terminal, semantic inspector, timeline. With no flags it starts your project's own Vitest in watch mode, points it at the runner through `TERMWRIGHT_UI_URL`, and opens the page in your browser; `--no-open` prints the URL instead; `--no-watch` opens the runner without starting a suite; `--trace` opens a `.twtrace` archive instead; `--record` drives a program you name and writes the test. Runner arguments go after `--`: `termwright ui -- src/login.test.ts --reporter=dot`. |
| `report` | writes the viewer and one archive as a **single HTML file**, openable from disk — a CI artifact rather than a server. `--json` prints `{path, bytes, cut}`. See [Runner UI](../../guides/runner-ui/). |
| `codegen` | `ui --record`, for when recording is the whole point. |
| `mcp` | serves the [MCP tools](../../guides/mcp/); every argument is forwarded to `@termwright/mcp` untouched. |
| `agent-context` | versioned JSON describing every tool, parameter and exit code. |
| `usage` | the one-screen cheat sheet. |
| `skill` | an agent-skill package: `SKILL.md`, `reference.md`, `agent-context.json`. |

Global flags: `--json` (machine-readable output; errors carry `kind`),
`--version` / `-v`, `--help` / `-h`.

`--json` also suppresses opening a browser, as do a non-terminal stdout and a
set `CI` — a window is for a person at a terminal, not for a build agent.

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
