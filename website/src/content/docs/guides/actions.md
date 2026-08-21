---
title: Actions and input
description: Send keyboard, text, paste, pointer, resize, and process input through the terminal boundary.
---

Termwright actions operate through the pseudo-terminal. Choose the highest-level
action that matches how the application is used.

## Recommended approach

| Need | Use |
| --- | --- |
| Activate the current control | `locator.activate()` |
| Send a key or chord | `app.press()` or `locator.press()` |
| Type normal text | `app.type()` or `locator.type()` |
| Insert clipboard-style text | `app.paste()` |
| Click an exact semantic target | `locator.click()` when hit testing is supported |
| Click empty space or a canvas cell | `app.mouse.click({row, column})` |
| Scroll a pointer-aware region | `locator.wheel()` |
| Change terminal dimensions | `app.resize()` |
| Send raw bytes | `app.write()` as a low-level escape hatch |

## Activate a control

```ts
const save = app.getByRole('button', {name: 'Save'});
const receipt = await save.activate();
```

`activate()` may use an exact pointer click or Enter/Space when the target is
already focused. It does not move focus by guessing a keyboard path. The
returned receipt identifies the strategy. Prefer it when the intended behavior
is “activate this control,” not “test mouse input.”

## Press keys

```ts
await app.press('Enter');
await app.press('Control+A');
await app.press('Shift+Tab');
await app.press('ArrowDown');
```

Send separate user interactions as separate calls. This gives the application
time to render between them and leaves clearer trace evidence:

```ts
await app.press('ArrowDown');
await expect(app.getByRole('listitem', {name: 'Settings'})).toHaveState({selected: true});
await app.press('Enter');
```

## Type and paste text

```ts
await app.getByRole('textbox', {name: 'Name'}).type('release');
await app.paste('multiple\nlines');
```

`type()` produces normal text input. `paste()` uses terminal paste behavior,
including bracketed paste when the application enables it.

## Click and drag

```ts
await app.getByRole('button', {name: 'Approve'}).click();
await app.getByRole('button', {name: 'Open menu'}).click({modifiers: ['control']});
await source.dragTo(destination, {steps: 12});
```

Pointer actions require terminal mouse reporting plus authoritative ownership.
That ownership is either verified by a negotiated production hit test, or is
an explicit application provider contract whose regions mean “cells currently
routed to this semantic recipient.” Ordinary layout bounds, paint order, and
annotations never become pointer ownership. When a hit test is negotiated,
Termwright always intersects and verifies the region against it.

Use `hitTest()` to inspect support and the recipient:

```ts
const hit = await approve.hitTest();
expect(hit.receivesEvents).toMatchObject({status: 'known', value: true});
```

See the [framework compatibility matrix](../../reference/compatibility/) before
depending on semantic pointer input. Keyboard input remains available when a
framework cannot publish hit-test ownership.

Raw coordinate actions use the same physical Mouse and PTY path. They are
appropriate for empty space, outside-click behavior, terminal canvases, and
mouse-capture tests:

```ts
await app.mouse.click({row: 3, column: 20, modifiers: ['shift']});
await app.mouse.drag({
  from: {row: 4, column: 2},
  to: {row: 9, column: 30},
  steps: 16,
});
```

## Scroll

```ts
await list.wheel({deltaY: 3});
```

The application must have mouse tracking enabled. For keyboard-driven TUIs,
prefer the same navigation keys a user would press.

## Resize the terminal

```ts
const receipt = await app.resize({columns: 120, rows: 40});
expect(receipt.requested).toEqual({columns: 120, rows: 40});
```

The receipt records the screen revision before and after the resize. Assert the
resulting layout separately.

## Focus, signals, and raw input

```ts
await app.window.focus();
await app.window.blur();
await app.signal('INT');
await app.write('\u001b[6n');
```

Use these APIs only when focus events, process signals, or a terminal protocol
sequence are themselves part of the test.

## Waiting around actions

Actions have bounded retry behavior, but they do not guess the final state of
the application. Assert that state:

```ts
await save.activate();
await expect(app).toHaveText('Saved');
```

Use `waitForStable()` before a geometry-dependent action when an animation or
layout transition is still moving the target.
