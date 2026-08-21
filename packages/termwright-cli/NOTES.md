# termwright (umbrella) — implementation notes

Decisions that are not obvious from the code.

## Subpaths, not one entry point

The brief asked for "a sensible one-starter-package surface — driver, test,
Ink component testing". They are all here, but on three entry points rather than one:

| Entry | Re-exports |
|---|---|
| `termwright` | `@termwright/driver` |
| `termwright/test` | `@termwright/test` |
| `termwright/ink` | `@termwright/ink` |
| `termwright/reporter` | `@termwright/test/reporter` |
| `termwright/ui-reporter` | `@termwright/ui/reporter` |

A single barrel would have been worse, and specifically: `@termwright/test`
imports Vitest and **registers matchers as a side effect of being imported**. Put
it behind the main entry and `import { launchTerminal } from 'termwright'` in a
production script pulls in a test runner and mutates a global `expect`. Behind a
subpath, Vitest stays an *optional* peer dependency and the same package can be
a dependency of both a test suite and a shipped tool.

`termwright/cli` is exported too, so a repository can build its own wrapper
around `runCli` without shelling out.

The two reporter subpaths exist because a `vitest.config.ts` must be writable
from the umbrella alone. Pointing a config at `@termwright/test/reporter`
resolves only where the package manager hoists transitive dependencies; under
pnpm's default layout a project whose devDependency is `termwright` cannot see
it. They are separate entries rather than members of `termwright/test` because
a config file runs before the test runner exists and must not import a module
that registers matchers.

`export *` does not re-export a default, and a Vitest config imports these by
default. `exports.test.ts` constructs both defaults for that reason.

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

## One watcher for the terminal, one-shot runs for the browser

`termwright ui` needs two things at once: the browser's rerun/stop buttons must
work, and the developer's terminal must keep watch mode's own hotkeys.

The long-lived `vitest watch` process therefore inherits stdin, stdout and
stderr. Vitest sees a real TTY and owns its native keyboard shortcuts; piping
stdin and forwarding bytes disabled the very hotkeys it was meant to preserve.

A browser Run/Rerun starts a separate `vitest run`. That child can receive an
authoritative file or stable case selection, and Stop terminates only that
one-shot process rather than killing the watcher and taking the UI server down
with it. A second browser run is refused while the first is active. There is no
Vitest Node API dependency and no fake keystroke protocol to keep in step with
Vitest internals.

The browser selection replaces the watcher's positional and
`-t`/`--testNamePattern` filters rather than intersecting with them. Other flags
survive. The selected ids also reach the UI reporter through
`TERMWRIGHT_UI_SELECTION`, so Vitest's filter-generated skipped siblings are not
published as genuine skipped results.

The binary is resolved from the *project's* `node_modules` via
`createRequire(cwd)`, not from this package's, so the version that runs the tests
is the version the project pinned.

## The CLI injects the UI reporter

Both watcher and one-shot commands receive `--reporter=default` plus the
absolute installed path of `@termwright/ui/reporter`. A project does not need to
edit `vitest.config.ts` before `termwright ui` can show a run, and a bare package
specifier is not resolved against whichever dependencies a strict project
happens to expose.

Vitest CLI reporter flags replace the reporters declared in its config. That is
a real tradeoff: JUnit, HTML or another configured reporter is not silently run
by the panel. A reporter explicitly forwarded after `--` composes with the two
injected entries.

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

The CLI suite injects the server boundary and separately starts a real child
process to pin watcher/one-shot/Stop lifecycle. The UI package's committed
Playwright suite owns the real-server/browser boundary. A manual smoke remains
useful for the assembled binary: `node dist/bin.js ui --no-watch --json` prints
its URL, serves the app over HTTP 200, and shuts down cleanly on SIGINT.

## Open threads

- **`termwright/opentui`** is not a subpath. Re-exporting the OpenTUI annotation SDK
  would put `@opentui/core` in the umbrella's peer dependencies for the benefit
  of the minority of users who need it; installing `@termwright/opentui`
  directly costs one line and keeps everyone else's install clean. Revisit if
  OpenTUI annotations become the common case.
- **Multi-runner support.** The `ui` command assumes Vitest. The driver is
  runner-agnostic, and `--no-watch` plus a manually started run already works
  for anything else; a `--runner` flag can come when someone asks.
- `CLI_VERSION` in `src/version.ts` duplicates `package.json`. Bump both.
