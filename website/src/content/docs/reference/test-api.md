---
title: Test API overview
description: Public test fixtures, sessions, locators, actions, observations, and matchers.
---

Import the normal testing surface from `termwright/test`:

```ts
import {test, expect} from 'termwright/test';
```

This page is a searchable map of the public API. Task-oriented examples live in
[Writing tests](../../writing-tests/), [Locators](../../guides/locators/),
[Actions and input](../../guides/actions/), and [Assertions](../../guides/assertions/).

## Test fixtures

### `test(name, callback)`

The Termwright Vitest test function. The callback receives:

| Fixture | Purpose |
| --- | --- |
| `terminal` | Launch an isolated terminal process. |
| `step` | Group actions and assertions under a named execution step. |
| `termwright` | Read resolved config, the private test directory, retained traces, and the step runner. |
| `termwrightOptions` | Apply file- or suite-scoped launch defaults with `test.scoped()`. |

`it` is an alias of `test`.

### `terminal.launch(options)`

Starts one application in a real PTY and returns a terminal session.

Common options include `command`, `cwd`, `env`, terminal `columns` and `rows`,
terminal profile, startup timeout, and semantic probe configuration. Test
fixtures use an isolated temporary working directory unless `cwd` is explicit.

### `terminal.attach(harness, options?)`

Adopts an existing `TerminalHarness` created by a component helper or framework
integration. The fixture publishes it to Runner, records its trace and logs,
collects crash metadata, and closes it after the test. Use this instead of a
manual `try/finally` when a component test should have normal Termwright
observability and lifecycle.

### `step(name, callback)`

Records a named group in traces, reports, and Runner UI. It does not change test
scheduling.

## Terminal session

The session exposes terminal-level input and observation:

| Method | Result |
| --- | --- |
| `press(key)` | Send a key or chord. |
| `type(text)` | Type text through terminal input. |
| `paste(text)` | Send a paste operation. |
| `resize({columns, rows})` | Resize and return a receipt tied to the rendered revision. |
| `waitForText(text, options?)` | Wait until the terminal contains text. |
| `screen()` | Take a screen snapshot; use `.text()`, `.line()`, or `.cell()`. |
| `getByRole(role, options?)` | Locate by semantic role and accessible name. |
| `getByText(text, options?)` | Locate semantic text. |
| `getByTestId(id)` | Locate an application-defined semantic test id. |

The exact type surface is exported by `@termwright/driver`, which the umbrella
package exposes through the supported Termwright entry points.

## Locator actions

| Method | Behavior |
| --- | --- |
| `press(key)` | Send a key to a focused or exactly targetable node. |
| `type(text)` | Type into a focused or exactly targetable node. |
| `activate()` | Activate an already focused node, or use an exact pointer recipient. |
| `click()` | Click only when exact pointer ownership is known. |
| `doubleClick()` | Double-click an exact pointer recipient. |
| `dragTo(target)` | Drag between two exact pointer recipients. |
| `wheel({deltaY, deltaX?})` | Send wheel input to an exact target. |
| `focusNode()` | Focus by an exact supported input strategy. |

Unsupported pointer targeting throws `UnsupportedActionError`. `activate()`
does not silently move focus to an arbitrary node.

## Locator observations

Observation methods return evidence-qualified results rather than guessing:

| Method | Observes |
| --- | --- |
| `geometry()` | Intended and visible rectangles when the framework can prove them. |
| `visibility()` | Attachment, display, viewport intersection, and visible cells. |
| `hitTest()` | Exact pointer recipient for terminal cells when supported. |
| `cellSnapshot()` | Current rendered terminal cells associated with the locator. |

An observation can be `known`, `absent`, `unknown`, or `unsupported`. Unknown
and unsupported evidence never satisfies either a positive or negated matcher.

## Matchers

### Terminal matchers

- `toHaveText(expected, options?)`
- `toMatchCellSnapshot(options?)`
- `toMatchSemanticSnapshot(pattern?, options?)`
- `toHaveLogged(query, options?)`

### Locator matchers

- `toBeAttached()` / `toBeDetached()`
- `toBeDisplayed()` / `toBeHidden()`
- `toBeVisible()` / `toBeOffscreen()`
- `toBeInViewport(options?)`
- `toReceivePointerEvents()`
- `toBeFocused()`
- `toHaveText(expected)`
- `toHaveState(expected)`
- `toHaveExtendedState(expected)`
- geometry and spatial matchers such as bounds, alignment, and relative position

Retrying matchers poll until their timeout. Unsupported evidence fails with the
capability reason instead of waiting for an impossible condition.

## Test configuration helpers

- `defineTermwrightConfig(config)`
- `configureTermwright(config)`
- `termwrightRetry(options)`
- `seedDirectory(files, options?)`

See [Configuration](../configuration/) for defaults and precedence.

## Snapshot helpers

- `serializeSemanticSnapshot(tree, options?)`
- `serializeScreen(cells, options?)`
- `matchSemanticSnapshot(actual, expected, options?)`

Most tests should use the matchers rather than these lower-level helpers.

## Reporter

Configure CI reports from `termwright/reporter`. Importing the reporter does not
register test matchers. See [CI](../../guides/ci/) and
[Traces and reports](../../tools/traces-reports/).
