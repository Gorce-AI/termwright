# termwright (umbrella) — implementation notes

Decisions that are not obvious from the code.

## Subpaths, not one entry point

The brief asked for "a sensible one-starter-package surface — driver, test,
ink-testing". They are all here, but on three entry points rather than one:

| Entry | Re-exports |
|---|---|
| `termwright` | `@termwright/driver` |
| `termwright/test` | `@termwright/test` |
| `termwright/ink` | `@termwright/ink-testing` |

A single barrel would have been worse, and specifically: `@termwright/test`
imports Vitest and **registers matchers as a side effect of being imported**. Put
it behind the main entry and `import { launchTerminal } from 'termwright'` in a
production script pulls in a test runner and mutates a global `expect`. Behind a
subpath, Vitest stays an *optional* peer dependency and the same package can be
a dependency of both a test suite and a shipped tool.

`termwright/cli` is exported too, so a repository can build its own wrapper
around `runCli` without shelling out.

## The CLI delegates rather than reimplements

`agent-context`, `usage`, `skill` and the MCP server itself are imported from
`@termwright/mcp` — `buildAgentContext()`, `buildUsage()`, `buildAgentSkill()`,
`runCli()` — never spawned as a subprocess. Consequences worth stating:

- there is exactly one implementation of each, so `termwright agent-context` and
  `termwright-mcp agent-context` cannot drift;
- the exit-code taxonomy, the `--json` error shape and the `kind` vocabulary come
  from `@termwright/mcp`'s `EXIT_CODES` / `exitCodeFor` / `toErrorPayload`, so
  this package forks none of CONTRACTS §MCP;
- `termwright mcp <args>` forwards everything after `mcp` verbatim, including
  flags this parser has never heard of. That is deliberate: the MCP CLI can grow
  options without this one being edited.

The one place the umbrella adds a rule of its own is `ui`: a failing test run
exits 1 (assertion), not 5 (internal). A red suite is the tool working.

## Driving Vitest through its stdin

`termwright ui` needs two things at once: the browser's rerun/stop buttons must
work, and the developer's terminal must keep watch mode's own hotkeys.

Vitest is therefore spawned with `stdin: 'pipe'` and `stdout`/`stderr`
inherited, and this process forwards its own stdin into the child. `onRerun`
writes `r` and `onStop` writes `q` — the same keys a person would press. No IPC
channel, no Vitest Node API dependency, and nothing to keep in step when Vitest
changes its internals.

The binary is resolved from the *project's* `node_modules` via
`createRequire(cwd)`, not from this package's, so the version that runs the tests
is the version the project pinned.

## Why `ui` closes the server in a `finally`

The runner mints a token and holds a port. If a run throws — a missing Vitest is
the common case — an early return would leave both alive for the rest of the
shell session. `runUi` closes the server on every path, and `cli.test.ts` asserts
that for the throwing case specifically.

## Testability

`runCli(argv, deps)` takes its collaborators — the UI server factory, the Vitest
launcher, the MCP CLI, `cwd`, and the output streams — as an injected object.
The suite therefore starts no server, spawns no process, and still covers every
command, both output modes and the whole exit-code taxonomy. The two things that
cannot be faked meaningfully (resolving the project's real Vitest binary, and the
`TERMWRIGHT_UI_URL` name the reporter reads) have their own assertions in
`ui-command.test.ts`.

Verified by hand, since no automated test starts a real server: `node
dist/bin.js ui --no-watch --json` prints its URL, serves the app over HTTP 200,
and shuts down cleanly on SIGINT.

## Open threads

- **`--open`** to launch a browser is not implemented; printing the URL is
  enough on a developer machine and the right thing over SSH.
- **`termwright/opentui`** is not a subpath. Re-exporting the OpenTUI adapter
  would put `@opentui/core` in the umbrella's peer dependencies for the benefit
  of the minority of users who need it; installing `@termwright/opentui`
  directly costs one line and keeps everyone else's install clean. Revisit if
  OpenTUI becomes the common case.
- **Multi-runner support.** The `ui` command assumes Vitest. The driver is
  runner-agnostic, and `--no-watch` plus a manually started run already works
  for anything else; a `--runner` flag can come when someone asks.
- `CLI_VERSION` in `src/version.ts` duplicates `package.json`. Bump both.
