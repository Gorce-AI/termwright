---
title: Packages and exports
description: Choose the Termwright packages needed by an application test suite.
---

Start with the umbrella package:

```sh
npm install --save-dev termwright
```

It provides the test command, Runner, and the imports used by most test suites.

## Imports from `termwright`

| Import               | Use                                                                      |
| -------------------- | ------------------------------------------------------------------------ |
| `termwright/test`    | Tests, assertions, fixtures, configuration, retries, and snapshots       |
| `termwright`         | Terminal sessions, locators, actions, and error types for custom helpers |
| `termwright/ink`     | Ink component-test helpers                                               |
| `termwright/gherkin` | Gherkin setup and step definitions                                       |
| `termwright/cli`     | Invoke the CLI from a Node.js program                                    |

Application tests should prefer these entry points over individual internal
packages. Do not import package `src/` or `dist/` paths.

`termwright/gherkin/runtime` and `termwright/host` support integrations built
around Termwright. They are not needed in an ordinary test suite.

## Framework integrations

Install a probe only when you want semantic locators for that framework. The
probe runs with the application and observes its rendered component tree.

| Framework  | Probe                       | Optional application annotations |
| ---------- | --------------------------- | -------------------------------- |
| Ink        | `@termwright/probe-ink`     | `@termwright/ink`                |
| OpenTUI    | `@termwright/probe-opentui` | `@termwright/opentui`            |
| Textual    | Python `termwright` package | `termwright.textual`             |
| tview      | `@termwright/probe-tview`   | Go `annotate` package            |
| Ratatui    | `termwright-probe-ratatui`  | `termwright-ratatui`             |
| Bubble Tea | `@termwright/probe-charm`   | Go `annotate` package            |

The annotations are optional. Add them only when the framework's built-in
component information does not express a role, accessible name, relationship,
or piece of application state needed by a test.

Follow the setup page for your framework under
[Framework integrations](../../adapters/). The compatibility table there also
shows which versions and pointer operations are supported.

## Building an integration

Packages such as `@termwright/driver`, `@termwright/protocol`, and
`@termwright/evidence-provider` are published for framework and tooling
authors. Their generated API reference is useful when building an integration,
but they are not extra installation choices for application testing.

Native PTY packages are installed as optional dependencies for the current
operating system and architecture. Do not select one manually. If the matching
native package is missing or cannot load, `npx termwright doctor` reports the
problem rather than switching to a less accurate fallback.
