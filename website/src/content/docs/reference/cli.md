---
title: CLI and exit codes
description: Commands, options, output modes, and process exit codes for the termwright executable.
---

Install the umbrella package to get the `termwright` executable:

```sh
npm install --save-dev termwright
npx termwright --help
```

## `termwright doctor`

```text
termwright doctor [--json]
```

Verifies the current Node.js version, the project's Vitest resolution, a real
PTY spawn/output/exit cycle, UTF-8 locale, artifact-directory access, and the
host platform. Warnings describe reduced portability; failed checks produce
exit code 1. Use `--json` in agents and environment diagnostics.

## `termwright test`

```text
termwright test [--runs N] [--resource-profile <name>]
                [--tags <expression>] [-- <test-runner args>]
```

Runs the project tests once. `--runs N` repeats the complete selected suite in
one Termwright process and returns the worst result. An infrastructure failure
stops later repetitions. Skipped, empty, and filtered-zero runs remain visible
but do not count as a passing suite.

`passed-with-skips` is a distinct amber result. It exits 0 only when the exact
skip policy matches. Undeclared or ambiguous skips and missing required skips
exit 1. JSON output includes the skipped test identities and policy issues.

Profiles are explicit: `local`, `ci`, `windows-ci`, or `stress`. Arguments after
`--` are test selection and runner options such as a file path, `-t`, or
`--retry`. `--tags` filters Gherkin scenarios with a Cucumber tag expression.
Any fail-then-pass result is flaky and exits non-zero.

## `termwright watch`

```text
termwright watch [--resource-profile <name>]
                 [--tags <expression>] [-- <test-runner args>]
```

Runs an initial suite, then reruns after source changes. A change that arrives
during a run is queued until that run finishes. The process returns the worst
observed result when interrupted. `--tags` and arguments after `--` have the
same meaning as for `test`.

## `termwright ui`

```text
termwright ui [--trace <path>] [--tags <expression>] [--port N] [--host H]
              [--no-watch] [--browser | --no-open]
              [-- <vitest args>]
termwright ui --record [--out-file <file>] -- <command>
```

Starts the Runner and test watch mode. Interactive use opens the Termwright
desktop app by default.

| Option                | Behavior                                                      |
| --------------------- | ------------------------------------------------------------- |
| `--browser`           | Open the Runner in the system browser.                        |
| `--no-open`           | Start the server without opening a window.                    |
| `--no-watch`          | Do not start the test watcher.                                |
| `--trace <path>`      | Open an existing `.twtrace` path.                             |
| `--tags <expression>` | Select physical Gherkin cases with a Cucumber tag expression. |
| `--record`            | Start recorder mode for the command after `--`.               |
| `--out-file <file>`   | Set the generated test destination in recorder mode.          |
| `--host <host>`       | Bind the Runner server to this host.                          |
| `--port <port>`       | Bind to this port; `0` selects an available port.             |

Arguments after `--` are passed to the embedded test runner:

```sh
npx termwright ui -- src/login.test.ts --retry=2
```

The Runner discovers TypeScript tests and physical Gherkin scenarios. You can
then run a directory, file, or individual case from its catalog.

## `termwright report`

```text
termwright report --trace <file> [--out-file <file>]
```

Writes a self-contained HTML report containing the React viewer and one trace.
The result can be opened directly from disk or stored as a CI artifact.

## `termwright screenshot`

```text
termwright screenshot --trace <file>
                      [--at <ms> | --step <number>]
                      [--out-file <file>] [--scale <number>]
```

Renders one trace moment to PNG. With no time or step, the command selects the
crash, the end of the last step, or the final useful frame.

## `termwright codegen`

```text
termwright codegen [--out-file <file>] -- <command>
```

An alias for using `ui --record` when recording is the only task.

## Agent commands

| Command                          | Result                                                 |
| -------------------------------- | ------------------------------------------------------ |
| `termwright mcp [args]`          | Run the MCP server; remaining arguments are forwarded. |
| `termwright agent-context`       | Print versioned JSON for MCP tools and exit codes.     |
| `termwright usage`               | Print the short command reference.                     |
| `termwright skill [--out <dir>]` | Generate an agent skill package.                       |

## Global options

| Option            | Behavior                                    |
| ----------------- | ------------------------------------------- |
| `--help`, `-h`    | Print help for the selected command.        |
| `--version`, `-v` | Print the installed version.                |
| `--json`          | Produce machine-readable output and errors. |

JSON output, CI, and non-interactive stdout suppress automatic window opening.

## Exit codes

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| `0`  | Success.                                                              |
| `1`  | Test run failed, was flaky, or did not meet the accepted skip policy. |
| `2`  | Invalid command-line usage.                                           |
| `3`  | No active session.                                                    |
| `4`  | IPC or transport failure.                                             |
| `5`  | Internal failure.                                                     |

Machine-readable errors include a `kind`, message, and applicable suggestion or
candidates. Library errors include stable kinds such as `timeout`,
`ambiguous-locator`, `probe-attach-failed`, `capability-unavailable`, `not-actionable`,
`input-mode-disabled`, `protocol-violation`,
`process-exited`, and `session-closed`.

See [Runner UI](../../tools/runner-ui/), [Traces and reports](../../tools/traces-reports/),
and [MCP tools](../mcp/).
