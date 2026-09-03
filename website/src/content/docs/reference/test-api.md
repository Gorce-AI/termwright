---
title: Test API overview
description: Public test fixtures, sessions, locators, actions, observations, and matchers.
---

Import the normal testing surface from `termwright/test`:

```ts
import { test, expect } from 'termwright/test';
```

This page is a searchable map of the public API. Task-oriented examples live in
[Writing tests](../../writing-tests/), [Locators](../../guides/locators/),
[Actions and input](../../guides/actions/), and [Assertions](../../guides/assertions/).
Exact signatures, option types, and return values are generated from the
published surface in the [TypeScript API reference](../../api/).

## Test fixtures

### `test(name, callback)`

Defines a test and provides Termwright's fixtures to its callback:

| Fixture             | Purpose                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `terminal`          | Launch an isolated terminal process.                                                       |
| `step`              | Group actions and assertions under a named execution step.                                 |
| `termwright`        | Read resolved config, the private working directory, retained traces, and run named steps. |
| `termwrightOptions` | Apply file- or suite-scoped launch defaults with `test.override()`.                        |

`it` is an alias of `test`.

### `terminal.launch(options)`

Starts one application in a real PTY and returns a terminal session.

Common options include `command`, `cwd`, `env`, terminal `columns` and `rows`,
terminal profile, operation timeouts, and framework integration configuration.
Test fixtures use an isolated temporary working directory unless `cwd` is
explicit.

### `terminal.attach(harness, options?)`

Adopts an existing `TerminalHarness` created by a component helper. The fixture
shows it in the Runner, records its trace and logs, and closes it after the
test. Use this instead of manual cleanup when a component test should behave
like a normal Termwright test.

### `terminal.openShell(options?)`

Opens a test-scoped interactive shell and enables exact command boundaries. It
uses PowerShell on Windows and `$SHELL -i` or `/bin/sh -i` on POSIX systems. Set
`shell` to choose another compatible shell command.

### `step(name, callback)`

Records a named group in traces, reports, and Runner UI. It does not change test
scheduling.

## Terminal session

The session exposes terminal-level input and observation:

| Method                                | Result                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `press(key)`                          | Send a key or chord.                                                                               |
| `type(text)`                          | Type text through terminal input.                                                                  |
| `paste(text)`                         | Send a paste operation.                                                                            |
| `resize({columns, rows})`             | Resize the terminal and return a resize receipt.                                                   |
| `waitForText(text, options?)`         | Wait until the terminal contains text.                                                             |
| `screen()`                            | Take a screen snapshot; use `.text()`, `.line()`, or `.cell()`.                                    |
| `terminalState.snapshot()`            | Read cursor, title, bell, buffer, dimensions, and terminal modes.                                  |
| `keyboard.press/type/paste`           | Use the one physical keyboard device directly.                                                     |
| `mouse.move/down/up/click/wheel/drag` | Use viewport coordinates, optional Shift/Alt/Control modifiers, and the one physical mouse device. |
| `checkpoint()`                        | Capture the current terminal and semantic state together.                                          |
| `waitForCheckpointChange({after})`    | Wait until either part of that state changes.                                                      |
| `getByRole(role, options?)`           | Locate by semantic role and accessible name.                                                       |
| `getByLabel(text, options?)`          | Locate a semantic control through its label relationship.                                          |
| `getByText(text, options?)`           | Locate semantic text.                                                                              |
| `getByScreenText(text, options?)`     | Locate text in the physical terminal grid, with optional occurrence and cell-style filters.        |
| `getByTestId(id)`                     | Locate an application-defined semantic test id.                                                    |

### `session.shell`

Provides command and prompt observations when the child shell supports OSC 133
shell integration:

| Method                          | Result                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `shell.run(command, options?)`  | Run one command and return its output, exit code, working directory, and title.      |
| `shell.waitForPrompt(options?)` | Wait for an OSC 133 input-prompt mark.                                               |
| `shell.status()`                | Read prompt state, last command exit code, OSC 7 cwd, title, cursor, and bell count. |

These methods do not infer prompts or command boundaries from rendered text.
See [Test commands in an integrated shell](../../guides/shell-commands/).

## Locator actions

`SemanticLocator` and `ScreenLocator` are separate types. Both support
composition with `within`, `filter`, `and`, `or`, `first`, and `nth`, and both
can perform pointer actions when their target is known.

| Both locator types         | Behavior                                                           |
| -------------------------- | ------------------------------------------------------------------ |
| `click({modifiers?})`      | Click when Termwright can identify the pointer target.             |
| `doubleClick()`            | Double-click a known pointer target.                               |
| `hover()`                  | Move the terminal pointer over the target.                         |
| `dragTo(target)`           | Drag between two known pointer targets in the same locator domain. |
| `wheel({deltaY, deltaX?})` | Send wheel input to a known pointer target.                        |
| `actionability(action)`    | Explain a click, double-click, or hover without executing it.      |

Semantic locators additionally provide actions based on application roles and
state:

| Semantic locator only   | Behavior                                                                   |
| ----------------------- | -------------------------------------------------------------------------- |
| `press(key)`            | Send a key to the located control.                                         |
| `type(text)`            | Type into the located control.                                             |
| `activate()`            | Activate a focused control or one with a known pointer target.             |
| `fill(text)`            | Focus through a known input strategy, then enter text.                     |
| `focus()`               | Focus the control through a known input strategy.                          |
| `check()` / `uncheck()` | Drive input and verify the resulting checked state.                        |
| `actionability(action)` | Also explain focus, activation, keyboard, fill, and checked-state actions. |

If an integration cannot identify a target, or the application has not enabled
the required terminal input mode, the action fails with the reason. Termwright
does not guess a coordinate or move focus to an unrelated control.

## Locator observations

Observation methods report what the framework integration can establish:

| Method           | Observes                                                           |
| ---------------- | ------------------------------------------------------------------ |
| `geometry()`     | Intended and visible rectangles when the framework can prove them. |
| `visibility()`   | Attachment, display, viewport intersection, and visible cells.     |
| `hitTest()`      | Exact pointer recipient for terminal cells when supported.         |
| `cellSnapshot()` | Current rendered terminal cells associated with the locator.       |

An observation can be `known`, `absent`, `unknown`, or `unsupported`. An
unknown or unsupported result does not pass a positive or negative assertion.

## Matchers

### Terminal matchers

- `toHaveText(expected, options?)`
- `toMatchCellSnapshot(expected?, options?)`
- `toMatchSemanticSnapshot(pattern?, options?)`
- `toHaveLogged(query, options?)`

### Matchers for both locator types

- `toBeAttached()` / `toBeDetached()`
- `toBeDisplayed()` / `toBeHidden()`
- `toBeVisible()` / `toBeOffscreen()`
- `toBeInViewport(options?)`
- `toReceivePointerEvents()`
- `toHaveBounds(expected, options?)`
- `toHaveSpatialRelation(expected, options?)`
- `toHaveText(expected)`
- `toMatchCellSnapshot(expected?, options?)`

### Semantic locator matchers

- `toBeFocused()`
- `toBeEnabled()` / `toBeDisabled()`
- `toBeChecked()` / `toBeSelected()` / `toBeExpanded()`
- `toHaveValue(expected)`
- `toHaveState(expected)`
- `toHaveExtendedState(expected)`

Retrying matchers check again when the relevant terminal, semantic, log, or
process state changes. Unsupported observations fail with the reason instead
of waiting until the assertion timeout.

## Test configuration helpers

- `defineTermwrightConfig(config)`
- `configureTermwright(config)`
- `termwrightRetry(options)`
- `seedDirectory(files, options?)`

See [Configuration](../configuration/) for defaults and precedence.

## Snapshot helpers

- `serializeSemanticSnapshot(tree, options?)`
- `serializeScreen(screen, options?)`
  Most tests should use the matchers rather than these lower-level helpers.

## Reports

Generate a standalone HTML report with
`npx termwright report --trace <path>`. No Termwright reporter is needed in
`vitest.config.ts`. See [CI](../../guides/ci/) and
[Traces and reports](../../tools/traces-reports/).
