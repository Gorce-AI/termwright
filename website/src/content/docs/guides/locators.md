---
title: Locators
description: Find semantic elements by role, label, text, test ID, or selector.
---

Locators find elements in the semantic tree published by your application or
framework integration. Prefer a role and accessible name when they describe what a
user interacts with.

```ts
const save = app.getByRole('button', {name: 'Save'});
await save.activate();
```

Locators resolve when you use them. You can create one before the matching
element appears and pass it to a retrying assertion.

## Recommended locator order

| Locator | Use when |
| --- | --- |
| `getByRole(role, {name})` | The element has user-facing meaning. This is the normal choice. |
| `getByLabel(text)` | A form control is identified by its label. |
| `getByText(text)` | Visible text is the behavior under test, not just a way to reach a control. |
| `getByTestId(id)` | The application has no stable user-facing identity for the element. |
| `locator(selector)` | You need a structural or framework-specific selector. |

Programs without a semantic tree do not support these locators. Use screen
text, cell assertions, and terminal-level input instead.

## Locate by role and name

```ts
const approve = app.getByRole('button', {name: 'Approve'});
const anyDialog = app.getByRole('dialog');
const matchingItem = app.getByRole('listitem', {name: /release/i});
```

Use an exact string for a stable accessible name. Use a regular expression when
part of the name is intentionally variable.

Framework-specific filtering is available for integrations that retain a
native component type:

```ts
const pane = app.getByRole('generic', {frameworkType: 'ScrollView'});
```

Treat this as specialized integration code. A role and name survive framework
refactors more often.

## Locate labeled controls

```ts
const name = app.getByLabel('Profile name');
await name.focusNode();
await name.type('release');
```

`getByLabel()` depends on the framework integration publishing the label
relationship. It does not infer labels from nearby rendered text.

## Locate by text

```ts
await expect(app.getByText('Connection lost')).toBeAttached();
await expect(app.getByText(/items: \d+/)).toHaveText(/items: 3/);
```

Use `app.waitForText()` when you only need to wait for characters on the
terminal grid. Use `getByText()` when you need a semantic element carrying that
text.

## Scope a locator

Use `within()` when the same control appears in more than one region:

```ts
const dialog = app.getByRole('dialog', {name: 'Delete note'});
const confirm = app
  .getByRole('button', {name: 'Delete'})
  .within(dialog);

await confirm.activate();
```

The locator remains strict inside the scope.

## Handle multiple matches

An action on a locator with multiple matches fails. Narrow it by name or scope
first. Use `first()` or `nth()` only when position is part of the behavior:

```ts
const rows = app.getByRole('listitem');
await expect(rows.nth(1)).toHaveText('Second result');
```

Inspect the count while diagnosing an ambiguous match:

```ts
expect(await app.getByRole('button').count()).toBe(3);
```

## Reuse a resolved reference

`locatorForRef()` is intended for tools such as the Runner and MCP integrations
that receive a semantic reference from a snapshot. Normal tests should prefer a
declarative locator.

Stable semantic identities may be resolved again after a new revision. A
frame-local reference cannot. Grid references remain tied to the revision that
created them.

## Related guides

- [Actions and input](../actions/)
- [Assertions](../assertions/)
- [Framework integrations](../../adapters/)
- [Geometry and visibility](../../reference/geometry-visibility/)
