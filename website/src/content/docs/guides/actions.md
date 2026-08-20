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
await source.dragTo(destination);
```

Pointer actions require two observable facts: terminal mouse reporting and an
exact hit test showing that the chosen cell belongs to the target. Termwright
does not infer ownership from paint order or unqualified bounds.

Use `hitTest()` to inspect support and the recipient:

```ts
const hit = await approve.hitTest();
expect(hit.receivesEvents).toMatchObject({status: 'known', value: true});
```

See the [framework compatibility matrix](../../reference/compatibility/) before
depending on semantic pointer input. Keyboard input remains available when a
framework cannot publish hit-test ownership.

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
await app.focus();
await app.blur();
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
