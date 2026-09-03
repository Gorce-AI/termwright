---
title: Supported platforms and limitations
description: Runtime, operating-system, terminal, framework, pointer, security, and recorder limits.
---

Check this page before adding Termwright to a CI matrix or depending on a
framework-specific assertion.

## Runtime and operating systems

<!-- BEGIN GENERATED RUNTIME REQUIREMENTS -->
<!-- Generated from package.json; do not edit this block by hand. -->
- Use Node.js 22 or 24. Other major versions are not supported.
- You do not need to install Vitest separately. Termwright includes Vitest 4.1.11.
<!-- END GENERATED RUNTIME REQUIREMENTS -->

| Platform | Minimum | Architectures |
| --- | --- | --- |
| Linux | glibc 2.35 (Ubuntu 22.04 ABI floor) | x64, arm64 |
| macOS | 13.5 | x64, arm64 |
| Windows | Windows 10 1809 or Server 2019 | x64, arm64 |

Alpine/musl is not supported by the native PTY package. A sandbox or container
that forbids pseudoterminal allocation cannot run terminal tests.

The Ratatui semantic transport is supported on Linux and macOS, not Windows.
Ratatui applications still run as black-box terminal programs on Windows.

## What works without an integration

Every supported terminal application can use:

- rendered text and cell assertions;
- keyboard input, paste, resize, and signals;
- raw coordinate mouse input when the application enables mouse reporting;
- process exit observation;
- traces and reports.

The terminal screen does not contain roles, labels, component identity, or
widget state. Those APIs require a [framework integration](../../adapters/).

## Framework versions

Ink, OpenTUI, Ratatui, and Bubble Tea use exact version lists. Textual and tview
accept compatible versions when runtime or compile-time capability checks pass.
See the [compatibility table](../compatibility/) before upgrading.

When semantics are required and an integration cannot attach, launch fails.
Otherwise the application can still be tested through the black-box terminal
API; Termwright does not publish a partial semantic tree.

Support also varies by operation. In particular, visibility needs clipped
viewport geometry, and clicking by locator needs the framework's actual pointer
routing. Intended layout bounds alone are not enough.

## Visibility and pointer input

When an integration cannot observe viewport clipping, `toBeVisible()` and
`not.toBeVisible()` both fail with an unsupported observation. Use
`toBeAttached()` only when semantic-tree membership is the behavior you mean.

Semantic pointer actions also require the application to enable terminal mouse
reporting. Some integrations need application pointer setup in addition to the
integration package. See [Geometry and visibility](../geometry-visibility/).

## Terminal compatibility

Termwright uses one terminal model for tests. It does not reproduce every
vendor-specific quirk of Terminal.app, Windows Terminal, iTerm2, or a remote
terminal. Configure a terminal profile for width and behavior differences that
Termwright supports, and run platform-specific behavior on the actual operating
system.

See [Terminal compatibility](../terminal-compatibility/) for the current model.

## Traces cannot invent missing data

A trace records what the terminal, integration, and application log channels
provided during the run. It cannot reconstruct a semantic tree, pointer target,
or log record that was never published.

Interrupted and damaged traces are labelled incomplete. They are not replayed as
successful empty runs.

## Redaction has explicit limits

Default trace redaction covers input values and secrets known to the session.
It does not discover every application-specific secret, and live crash or MCP
screen tails can contain terminal output verbatim. Read
[Protect secrets](../security/) before sharing artifacts or using credentials.

## Recorder output needs review

Recorder can turn observed input and semantic targets into test source. It
cannot choose domain assertions, add missing application semantics, or know
which locator will remain stable through a future refactor. Review generated
source before saving it.

## Gherkin scope

Termwright runs physical `.feature` files and supports scenario hooks and
Cucumber tag expressions. It does not provide a Termwright-specific language
server; use a Cucumber editor extension for syntax and step navigation.
