---
title: Packages and exports
description: Supported imports from the Termwright umbrella package and specialist packages.
---

Most projects install only the umbrella package:

```sh
npm install --save-dev termwright vitest
```

## Public umbrella exports

| Import | Use |
| --- | --- |
| `termwright` | Driver sessions, terminal model, locators, actions, and errors. |
| `termwright/test` | Vitest fixture, `expect`, matchers, snapshots, config, retries, and seeding. |
| `termwright/ink` | Ink component-test helpers. |
| `termwright/gherkin` | Gherkin plugin and step-definition API. |
| `termwright/reporter` | Trace and CI report integration. |
| `termwright/ui-reporter` | Live Runner reporter for manually managed hosts. |
| `termwright/cli` | Programmatic CLI entry. |

Prefer these imports in application test suites. They keep setup consistent and
avoid depending on transitive packages.

## Framework packages

Framework probes and annotation SDKs are separate because they run inside or
instrument the application:

| Framework | Probe | Optional annotations |
| --- | --- | --- |
| Ink | `@termwright/probe-ink` | `@termwright/ink` |
| OpenTUI | `@termwright/probe-opentui` | `@termwright/opentui` |
| Textual | Python `termwright` probe | `termwright.textual` |
| tview | `@termwright/probe-tview` | Go `annotate` package |
| Ratatui | `termwright-probe-ratatui` | `termwright-ratatui` |
| Bubble Tea | `@termwright/probe-charm` | Go `annotate` package |

See [Framework integrations](../../adapters/) before adding one.

## Specialist packages

The monorepo also publishes focused packages for the driver, protocol, VT
emulator, traces, screenshots, logs, UI server, MCP server, and conformance.
Use them when building an integration or embedding one subsystem. Their package
READMEs and exported TypeScript types are the reference for that specialist
surface.

Do not import internal `src/` or `dist/` paths. Only package `exports` entries
are public.
