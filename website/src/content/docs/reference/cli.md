---
title: CLI and exit codes
description: Commands, options, output modes, and process exit codes for the termwright executable.
---

Install the umbrella package to get the `termwright` executable:

```sh
npm install --save-dev termwright
npx termwright --help
```

## `termwright ui`

```text
termwright ui [--trace <file>] [--tags <expression>] [--port N] [--host H]
              [--no-watch] [--browser | --no-open]
              [-- <vitest args>]
termwright ui --record [--out-file <file>] -- <command>
```

Starts the Runner and Vitest watch mode. Interactive use opens the Termwright
desktop app by default.

| Option | Behavior |
| --- | --- |
| `--browser` | Open the Runner in the system browser. |
| `--no-open` | Start the server without opening a window. |
| `--no-watch` | Do not start the Vitest watcher. |
| `--trace <file>` | Open an existing `.twtrace` archive. |
| `--tags <expression>` | Select physical Gherkin cases with a Cucumber tag expression. |
| `--record` | Start recorder mode for the command after `--`. |
| `--out-file <file>` | Set the generated test destination in recorder mode. |
| `--host <host>` | Bind the Runner server to this host. |
| `--port <port>` | Bind to this port; `0` selects an available port. |

Arguments after `--` are passed to Vitest:

```sh
npx termwright ui -- src/login.test.ts --retry=2
```

The UI host discovers provider-owned TypeScript tests and physical Gherkin
scenarios. Directory, file, and case runs are validated against that catalog.

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

| Command | Result |
| --- | --- |
| `termwright mcp [args]` | Run the MCP server; remaining arguments are forwarded. |
| `termwright agent-context` | Print versioned JSON for MCP tools and exit codes. |
| `termwright usage` | Print the short command reference. |
| `termwright skill [--out <dir>]` | Generate an agent skill package. |

## Global options

| Option | Behavior |
| --- | --- |
| `--help`, `-h` | Print help for the selected command. |
| `--version`, `-v` | Print the installed version. |
| `--json` | Produce machine-readable output and errors. |

JSON output, CI, and non-interactive stdout suppress automatic window opening.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Test or assertion failed. |
| `2` | Invalid command-line usage. |
| `3` | No active session. |
| `4` | IPC or transport failure. |
| `5` | Internal failure. |

Machine-readable errors include a `kind`, message, and applicable suggestion or
candidates. Library errors include stable kinds such as `timeout`,
`ambiguous-locator`, `unsupported-action`, `protocol-violation`,
`process-exited`, and `session-closed`.

See [Runner UI](../../tools/runner-ui/), [Traces and reports](../../tools/traces-reports/),
and [MCP tools](../mcp/).
