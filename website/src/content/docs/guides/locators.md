---
title: Choose a locator
description: Find controls by role or label, and find rendered regions by screen text.
---

Prefer a locator that describes how a user identifies the control:

```ts
const save = app.getByRole('button', { name: 'Save' });
await expect(save).toBeAttached();
```

Every locator in the table except `getByScreenText()` requires a
[framework integration](../../adapters/). For an uninstrumented CLI or TUI, use
rendered screen text instead.

## Locator priority

| Prefer                      | Use it for                                                  |
| --------------------------- | ----------------------------------------------------------- |
| `getByRole(role, { name })` | A control with a user-facing role and name                  |
| `getByLabel(text)`          | An input identified by a label                              |
| `getByText(text)`           | Text belonging to a semantic element                        |
| `getByTestId(id)`           | A stable identity with no useful user-facing name           |
| `getByScreenText(text)`     | Characters and styling on the terminal grid                 |
| `locator(selector)`         | An advanced semantic or framework-specific structural query |

Move down the list only when the earlier locator cannot express the behavior.
Structural selectors and manual coordinates are more likely to change during a
UI refactor.

## Find a control by role

```ts
const approve = app.getByRole('button', { name: 'Approve', exact: true });
const dialog = app.getByRole('dialog');
const release = app.getByRole('listitem', { name: /release/i });
```

A string matches a case-insensitive substring by default. Add `exact: true` to
match the complete name. Use a regular expression when the pattern is
intentionally variable.

Locators are evaluated when an action or assertion uses them, so the element
does not need to exist when you create the locator:

```ts
const result = app.getByRole('status');
await app.press('Enter');
await expect(result).toHaveText('Saved');
```

## Find a labeled input

```ts
const name = app.getByLabel('Profile name');
await name.focus();
await name.type('release');
```

`getByLabel()` uses a label relationship published by the application
integration. It does not assume that nearby text is a label. Finding the
element and being able to focus or type into it are separate integration
features.

## Find rendered screen text

`getByScreenText()` searches the physical terminal grid. It works with every
application and can distinguish an occurrence or cell style:

```ts
const secondError = app.getByScreenText('ERROR', {
  occurrence: 2,
  fg: 'red',
});

await expect(secondError).toBeVisible();
```

`occurrence` is one-based, so `2` selects the second matching region.

A screen locator represents a rectangle of terminal cells. Use it for styled
output, custom drawing, and black-box applications. It cannot expose semantic
state such as a role, label, checked state, or focus owner.

Use `app.waitForText('Ready')` when you only need to wait for characters and do
not need a reusable region.

## Narrow a match

Scope a common control to a semantic container:

```ts
const dialog = app.getByRole('dialog', { name: 'Delete note' });
const confirm = app.getByRole('button', { name: 'Delete' }).within(dialog);

await confirm.activate();
```

An action fails if its locator matches more than one element. Narrow by name or
scope first. Use `first()` or `nth()` only when order is part of the behavior:

```ts
const rows = app.getByRole('listitem');
await expect(rows.nth(1)).toHaveText('Second result');
```

During debugging, inspect the number of matches:

```ts
expect(await app.getByRole('button').count()).toBe(3);
```

## Semantic and screen locators do not mix

Semantic locators represent application elements. Screen locators represent
terminal cells. You can scope a semantic locator within another semantic
locator, but not within a screen rectangle. TypeScript reports the mismatch.

This distinction prevents a visual coincidence from becoming an application
identity. See [How semantic locators work](../../concepts/semantics/) for the
underlying model.

## Next steps

- [Send input](../actions/)
- [Use retrying assertions](../assertions/)
- [Check framework support](../../adapters/)
