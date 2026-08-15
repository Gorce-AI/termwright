---
title: Packages
description: What each package is for, what it may depend on, and which one you actually need.
---

## What to install

| You want to… | Install |
|---|---|
| write terminal tests with Vitest | `@termwright/test` |
| drive a terminal from any runner or a plain script | `@termwright/driver` |
| make an Ink app addressable by role and name | `@termwright/ink` |
| test Ink components instead of processes | `@termwright/ink-testing` |
| give an AI agent a terminal | `@termwright/mcp` |
| open a live runner, inspector and time-travel UI | `@termwright/ui` |
| turn a screen into an SVG or PNG without a browser | `@termwright/screenshot` |
| certify your own adapter | `@termwright/conformance` |

## The map

| Package | Purpose |
|---|---|
| `@termwright/protocol` | Schemas, limits, roles, framing, handshake, marker, validation. Zero framework dependencies. |
| `@termwright/driver` | PTY + VT emulator, sessions, screen model, locators, actions, waits, typed errors, recording hooks. |
| `@termwright/test` | Vitest preset: fixtures, matchers, semantic and cell snapshots, trace reporter, flaky classification, config. |
| `@termwright/ink` | Production adapter for Ink 7 (`aria-*` props + `useSemantic`). |
| `@termwright/ink-testing` | `mountInk` (in-process) and `launchInkFixture` (real pty). |
| `@termwright/opentui` | Adapter for OpenTUI. |
| `@termwright/mcp` | MCP server over the public driver API. |
| `@termwright/trace` | The `.twtrace` format: writer, streaming reader, HTML report generator. |
| `@termwright/screenshot` | SVG with embedded glyph outlines, and PNG through resvg. No browser. |
| `@termwright/ui` | Interactive runner: local server plus browser app. |
| `@termwright/conformance` | Fixtures and the reusable adapter contract suite. |
| `termwright` | Umbrella package and CLI. Subpaths: `termwright` (driver), `/test` (Vitest preset), `/ink` (component testing), `/reporter` and `/ui-reporter` (for `vitest.config.ts`), `/cli`. |

Other registries, same repository:

| Package | Registry | Contents |
|---|---|---|
| `termwright` | PyPI | protocol client + Textual adapter |
| `github.com/gorce-ai/termwright/clients/go` | Go modules | protocol client + tview adapter |
| `termwright-protocol` | crates.io | protocol client (a Ratatui adapter is 1.x) |

Each is versioned independently and bound to the **protocol** version.

## Dependency rules

These are enforced by review, and they are what keeps the driver installable in
a project that has never heard of React:

- `protocol` depends on `zod` only — never on React, Ink, MCP, PTY or the driver;
- `driver` depends on `protocol` plus the PTY and VT libraries — never on Ink,
  Vitest or MCP;
- **adapters** depend on `protocol` and their framework — never on the driver;
- `test` depends on `driver` (+ `trace`, + protocol types) and declares `vitest`
  as a peer;
- `ink-testing` depends on `driver`, `ink` and `protocol`;
- `mcp` depends on `driver` and the MCP SDK behind a facade, and owns no session
  logic of its own;
- `trace` consumes driver types only, and may type-import from `protocol`;
- `ui` depends on `trace` and `driver`, and talks to Vitest only through our own
  event protocol;
- `conformance` may depend on everything; nothing depends on it.

## Engineering baseline

ESM only, Node >= 22, TypeScript strict, built with tsup, tested with Vitest, no
default exports, no `any` in public surfaces. Errors crossing a package boundary
are `TermwrightError` subclasses. All I/O is bounded by the protocol's limit
sets, and hostile-input suites must pass under `node --max-old-space-size=128`.
