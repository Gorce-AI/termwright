# termwright — implementation notes

Decisions that are not obvious from the code.

## One product host

`termwright test`, `termwright watch`, and `termwright ui` are three commands
over one `TermwrightTestHost`. The host embeds exact-certified Vitest 4.1.11 for
collection, transforms, mocks, assertions and worker execution. Termwright owns
the run identity, exact runner, EventJournal, ResourceBroker, persistence,
terminal cleanup and UI projection.

There is deliberately no reporter-based or direct-`vitest` Termwright mode.
Those paths cannot provide the host's RunId/AttemptId hierarchy, cross-worker
resource budget, stale-producer rejection or finalization barrier. User-defined
Vitest reporters are preserved as projections when the host loads the user's
configuration; they never become a correctness transport.

## Public subpaths

| Entry                | Re-exports                |
| -------------------- | ------------------------- |
| `termwright`         | `@termwright/driver`      |
| `termwright/test`    | `@termwright/test`        |
| `termwright/ink`     | `@termwright/ink`         |
| `termwright/gherkin` | `@termwright/gherkin`     |
| `termwright/host`    | native-host embedding API |
| `termwright/cli`     | programmatic CLI entry    |

The runtime driver remains separate from the test DSL so a production script
can drive a terminal without importing Vitest or registering matchers. That is
module hygiene, not a second certified test execution mode.

## Native selection and reruns

The host collects the graph programmatically and binds every native Vitest test
id to a RunnerTaskId and SpecId before execution. Browser reruns target those
native ids in the same persistent engine. They never reconstruct identity from
file/title and never spawn a sibling Vitest universe. A stop request names the
exact RunId, so a stale request cannot cancel a later watch run.

## Reporter composition

Vitest's implicit default reporter is removed because Termwright owns its
concise human projection. Reporters explicitly configured by a user remain in
their original order. The structured Termwright journal uses its own
authenticated worker transport and does not depend on reporter stdout or
callback ordering.

## Resource and persistence boundary

Every run starts one authenticated broker and journal server. Attempts acquire
atomic resource vectors before launching a PTY or external process. The run is
terminal only after attempts and sessions close, journal barriers flush and the
canonical run-history transaction (manifest plus accepted events) commits by
atomic rename. Projection or persistence failure is infrastructure state, not a
red assertion disguised as a test result.

## CLI delegation

`agent-context`, `usage`, `skill` and MCP commands delegate to `@termwright/mcp`
instead of forking their taxonomies. `runCli(argv, deps)` keeps its external
boundaries injectable, while exact host/PTY/browser integration tests exercise
the real assembled product.

## Open thread

- `CLI_VERSION` in `src/version.ts` duplicates `package.json`; generate it as
  part of packaging once the release manifest becomes the single version
  source.
