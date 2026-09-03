---
title: Send input
description: Press keys, type and paste text, use the mouse, resize the terminal, and send signals.
---

Termwright sends input through the same pseudoterminal used by the application.
Choose the action that matches what a user does.

| Task                        | API                                |
| --------------------------- | ---------------------------------- |
| Activate a known control    | `locator.activate()`               |
| Press a key or chord        | `app.press()` or `locator.press()` |
| Type text                   | `app.type()` or `locator.type()`   |
| Paste text                  | `app.paste()`                      |
| Click a supported control   | `locator.click()`                  |
| Click a terminal coordinate | `app.mouse.click()`                |
| Scroll                      | `locator.wheel()`                  |
| Resize the terminal         | `app.resize()`                     |

## Activate a control

Use `activate()` when the behavior is “activate this control” and the input
method is not important:

```ts
const save = app.getByRole('button', { name: 'Save' });
await save.activate();
await expect(app.getByRole('status')).toHaveText('Saved');
```

Depending on the integration, Termwright may click the control or use a
supported keyboard action. It does not guess a Tab sequence. The action fails
before sending input if the integration cannot identify a valid strategy.

## Press keys

```ts
await app.press('Enter');
await app.press('Control+A');
await app.press('Shift+Tab');
await app.press('ArrowDown');
```

Send separate interactions as separate calls when the application must render
between them:

```ts
await app.press('ArrowDown');
await expect(app.getByRole('listitem', { name: 'Settings' })).toBeSelected();
await app.press('Enter');
```

`press('Tab Enter')` sends both chords in one write. This is useful for a key
sequence consumed as a unit, but not for navigating between controls that
rerender after each key.

## Type or paste text

```ts
await app.getByRole('textbox', { name: 'Name' }).type('release');
await app.paste('first line\nsecond line');
```

`type()` sends normal text input. `paste()` uses bracketed paste when the
application enables it, so multi-line content is not mistaken for separate
commands by applications that support that terminal mode.

Plain typed and pasted values are treated as sensitive in recorded action data
by default. The application can still echo them to the terminal; read
[Protect secrets](../../reference/security/) before using real credentials.

## Click a control

```ts
await app.getByRole('button', { name: 'Approve' }).click();
await app.getByRole('button', { name: 'Open menu' }).click({
  modifiers: ['control'],
});
```

All mouse input requires the application to enable terminal mouse reporting. A
semantic click additionally requires:

- a framework integration that can identify the cells routed to that control.

Layout bounds alone are not enough. Check the
[framework compatibility matrix](../../reference/compatibility/) before making
pointer input part of a test. Keyboard actions remain available when semantic
clicking is not supported.

Use a coordinate when the coordinate itself matters—for example an outside
click, a drawing canvas, or mouse-capture behavior:

```ts
await app.mouse.click({ row: 3, column: 20, modifiers: ['shift'] });
await app.mouse.drag({
  from: { row: 4, column: 2 },
  to: { row: 9, column: 30 },
  steps: 16,
});
```

Rows and columns are zero-based viewport coordinates.

## Scroll and drag

```ts
await list.wheel({ deltaY: 3 });
await source.dragTo(destination, { steps: 12 });
```

The same pointer requirements apply. For a keyboard-driven TUI, prefer the
navigation keys its users normally press.

## Resize the terminal

```ts
await app.resize({ columns: 120, rows: 40 });
await expect(app).toHaveText('Wide layout');
```

Assert the responsive layout separately. The resize receipt confirms that the
request completed; it does not decide what the application should render.

## Send signals or raw terminal data

```ts
await app.signal('INT');
await app.write('\u001b[A'); // raw bytes for an Up-arrow input
```

Use `signal()` when signal handling is under test. `write()` sends raw data and
is intended for terminal-protocol cases; prefer `press()`, `type()`, or
`paste()` for normal user input.

## Wait for the result

A locator action waits until its target is ready or its action timeout expires.
Once physical input starts, Termwright does not repeat it. Assert the state
produced by the action:

```ts
await save.activate();
await expect(app).toHaveText('Saved');
```

If an animation is moving a pointer target, call `waitForQuiet()` before the
geometry-dependent action. Do not use it as a general replacement for a focused
assertion.

## Next steps

- [Use retrying assertions](../assertions/)
- [Check geometry and visibility support](../../reference/geometry-visibility/)
- [Debug input that had no effect](../../tools/debugging/)
