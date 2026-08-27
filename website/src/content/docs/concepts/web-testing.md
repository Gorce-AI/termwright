---
title: Coming from Playwright or Cypress
description: Map familiar browser-testing concepts to terminal tests without treating the tools as interchangeable.
---

Termwright tests terminal applications. It does not replace Playwright or
Cypress for browser applications, and an existing web test suite is not a
Termwright migration source.

If you already use a modern browser test runner, parts of the authoring model
will feel familiar:

| Browser testing            | Termwright                                                 |
| -------------------------- | ---------------------------------------------------------- |
| browser or page session    | terminal session in a real PTY                             |
| rendered DOM               | rendered terminal grid plus an optional semantic tree      |
| `getByRole()`              | semantic locator when a framework integration is available |
| browser keyboard and mouse | keyboard and mouse input sent through the PTY              |
| retrying locator assertion | retrying Termwright assertion                              |
| trace viewer               | Runner replay and the retained HTML report                 |

## Important differences

- A generic CLI has no DOM. Start with rendered text, terminal cells, keyboard
  input, process behavior, and snapshots.
- Semantic roles, state, geometry, and pointer ownership require a supported
  framework integration. Each fact is available only when the framework can
  establish it.
- Pointer actions run only when Termwright can prove the exact recipient.
- Each test starts with an isolated working directory unless you set `cwd`.

See [Getting started](../../getting-started/) for the normal first test and
[Why a real terminal?](../../guides/why-not-tmux/) for the execution model.

## Reuse Gherkin feature prose

Existing `.feature` files may remain useful when their scenarios describe
behavior that also applies to a terminal UI. Reuse the prose, then replace
browser-specific step definitions with steps that use Termwright's `terminal`
fixture, locators, input, and assertions.

DOM selectors, `page` fixtures, and `cy.*` commands do not carry over. This is
not a migration from `playwright-bdd` or a Cypress Cucumber integration; it is a
new terminal implementation of shared scenarios.

See [Gherkin scenarios](../../guides/gherkin/) for a complete terminal example.
