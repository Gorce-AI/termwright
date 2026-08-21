---
title: TypeScript API reference
description: Exact generated signatures for Termwright tests, terminal sessions, Ink component tests, and Gherkin.
editUrl: false
---

This reference is generated from the public TypeScript entry points. Use the
task guides for recommended workflows and this section for exact signatures,
option types, return values, and errors.

## Choose an API surface

- [`termwright/test`](./test/) — Vitest fixtures, configuration, matchers,
  snapshots, logs, and project matrices.
- [`termwright/driver`](./driver/) — terminal sessions, locators, input,
  shell commands, observations, and errors. Use this directly when building
  custom tooling.
- [`termwright/ink`](./ink/) — `mountInk()` and `launchInkFixture()` for Ink
  component tests.
- [`termwright/gherkin`](./gherkin/) — step definitions, hooks, resources, and
  the Gherkin plugin.

Install `termwright` for normal projects. The scoped package names shown in
generated headings identify the implementation package behind each umbrella
export; they are not additional installation steps.
