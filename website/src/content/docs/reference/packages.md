---
title: Packages and exports
description: Supported imports from the Termwright umbrella package and specialist packages.
---

Most projects install only the umbrella package:

```sh
npm install --save-dev termwright
```

## Public umbrella exports

| Import               | Use                                                                          |
| -------------------- | ---------------------------------------------------------------------------- |
| `termwright`         | Driver sessions, terminal model, locators, actions, and errors.              |
| `termwright/test`    | Vitest fixture, `expect`, matchers, snapshots, config, retries, and seeding. |
| `termwright/ink`     | Ink component-test helpers.                                                  |
| `termwright/gherkin` | Gherkin plugin and step-definition API.                                      |
| `termwright/cli`     | Programmatic CLI entry.                                                      |

Prefer these imports in application test suites. They keep setup consistent and
avoid depending on transitive packages.

## Framework packages

Framework probes and annotation SDKs are separate because they run inside or
instrument the application:

| Framework  | Probe                       | Optional annotations  |
| ---------- | --------------------------- | --------------------- |
| Ink        | `@termwright/probe-ink`     | `@termwright/ink`     |
| OpenTUI    | `@termwright/probe-opentui` | `@termwright/opentui` |
| Textual    | Python `termwright` probe   | `termwright.textual`  |
| tview      | `@termwright/probe-tview`   | Go `annotate` package |
| Ratatui    | `termwright-probe-ratatui`  | `termwright-ratatui`  |
| Bubble Tea | `@termwright/probe-charm`   | Go `annotate` package |

See [Framework integrations](../../adapters/) before adding one.

### Ink package names

The three Ink-related names serve different processes:

| Package                 | Where it runs            | Install when                                                                         |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| `termwright/ink`        | test process             | Writing Ink component tests. This is the recommended test import.                    |
| `@termwright/probe-ink` | launched Ink application | Adding semantic observation to an end-to-end Ink test.                               |
| `@termwright/ink`       | Ink application          | Adding optional roles, names, or domain annotations that Ink does not retain itself. |

`termwright/ink` re-exports the focused `@termwright/ink` package. Most
projects should not add both dependencies.

## Specialist and supporting packages

The monorepo also publishes focused packages for the driver, protocol, traces,
screenshots, logs, MCP, and conformance. Use them when building an integration
or embedding one subsystem.

`@termwright/driver` has two explicit stability tiers. Its root is the supported
application-test contract (terminal sessions, locators, actions, observations
and errors). `@termwright/driver/experimental` is only for adapter and harness
authors who need PTY backends, encoders, selector parsers, process supervision
or launch-resource injection. The umbrella package does not re-export that
experimental tier. Its generated reference is published separately as the
[experimental driver API](../../api/driver-experimental/).

Some published packages are shared implementation dependencies: the desktop
host, VT core, probe runtime, Go probe tooling, recognizers, and UI server.
They must be accessible from npm because other published packages depend on
them, but ordinary test suites should use `termwright` and the framework table
above. A package being present on npm does not make it an additional setup
choice.

The private `@termwright/local-transport` workspace package is the internal
Node-only IPC building block used by the resource broker and run-journal
transport. Its implementation is bundled into those published consumers; it
is neither an application-test API nor a separately installable package.

`@termwright/pty` is the internal native PTY backend on macOS, Linux and
Windows. Its six optional `@termwright/pty-{platform}-{architecture}` packages
carry the prebuilt native addons selected by the package manager. They are not
user-facing adapters. Every supported platform deliberately has no fallback
PTY: a missing or unloadable matching prebuild is an actionable startup error.
Windows prebuilds also carry a pinned, hash-validated Microsoft ConPTY runtime.
It is loaded only from the package directory and never falls back to the inbox
conhost, whose rendered output path cannot provide Termwright's causal semantic
frame barrier.

Do not import internal `src/` or `dist/` paths. Only package `exports` entries
are public.
