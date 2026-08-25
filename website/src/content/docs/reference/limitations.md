---
title: Platforms and limitations
description: Current runtime requirements, framework constraints, and unsupported workflows.
---

This page lists product limits that can change how a test should be written.
Framework-specific operation support is maintained in
[Framework compatibility](../compatibility/).

## Runtime requirements

<!-- BEGIN GENERATED RUNTIME REQUIREMENTS -->
<!-- Generated from package.json; do not edit this block by hand. -->
- Node.js must match `^22.0.0 || ^24.0.0`: supported major lines are 22 and 24; unlisted lines such as 23 and 25 are excluded.
- Termwright embeds and certifies exactly Vitest 4.1.11.
<!-- END GENERATED RUNTIME REQUIREMENTS -->
- PTY tests require an operating system and environment that can allocate a PTY.
- The Ratatui semantic transport is supported on macOS and Linux, not Windows.

## Generic terminal mode

Generic mode observes terminal cells and sends real terminal input. It does not
know application roles, accessible names, widget values, or component identity.
Add a framework integration when tests need those facts.

## Pointer actions

Pointer actions require exact recipient evidence and terminal mouse mode. Only
frameworks that expose fresh-pointer routing can provide semantic click
support. Use keyboard input when the compatibility matrix marks pointer actions
unsupported.

## Visibility

`toBeVisible()` requires qualified viewport evidence. A framework that cannot
expose clipping returns `unsupported`; a temporarily incomplete observation is
`unknown`. Neither positive nor negated assertions pass without known evidence.
Use `toBeAttached()` or `toBeDisplayed()` when that is the behavior you need.

## Gherkin

Termwright provides scenario-scoped hooks and Cucumber tag-expression
filtering, but not a Termwright-specific Gherkin language server. Use the official Cucumber
extension for syntax and definition navigation. `.feature` files run through
the same Vitest scheduler and Runner catalog as provider-owned TypeScript tests.

## Trace evidence

Evidence that a framework or application never published cannot be reconstructed
after the run. A report can show terminal output without a semantic tree, or an
actionless test without a terminal session. Runner labels these states rather
than fabricating steps or targets.

## Recorder

Recorder generates a starting test from observable terminal actions and
semantic targets. It cannot infer domain assertions, replace missing framework
semantics, or guarantee that generated selectors are the best long-term
selectors. Review generated source before saving.

## Secrets

Termwright withholds known password values from semantic output. Terminal bytes
and application logs may still contain secrets emitted by the application.
Sanitize fixtures and CI artifacts accordingly.

## Unsupported framework versions

Build-instrumented integrations refuse unverified framework versions and
dependency graphs. This prevents a partially instrumented build from producing
plausible but incomplete semantic data. Check the compatibility page before
upgrading the framework.
