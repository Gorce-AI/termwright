---
title: How semantic locators work
description: Understand the difference between terminal cells and application elements.
---

A terminal screen contains characters, colors, attributes, and a cursor. It
does not say that `[ Save ]` is a button, that an input is labelled “Name”, or
that a list item is selected.

A framework integration can publish those application elements as a semantic
tree. Termwright keeps the screen and semantic tree separate because they
answer different questions.

| Question                                     | Source                                |
| -------------------------------------------- | ------------------------------------- |
| What characters and styles were rendered?    | Terminal screen                       |
| Did the program enable mouse or paste modes? | Terminal emulator                     |
| Which element is a button named Save?        | Framework integration                 |
| Which element is focused or selected?        | Framework integration, when available |
| Is an element inside the viewport?           | Framework geometry, when available    |
| Which element receives a click at this cell? | Framework hit testing, when available |

## Semantics are optional

Every terminal application supports screen text, cell snapshots, keyboard
input, paste, resize, process status, and traces. Add a framework integration
only when roles, labels, element state, or locator-based pointer input make a
test clearer.

```ts
// Works with any terminal program.
await app.waitForText('Save changes?');
await app.press('Enter');

// Requires a framework integration.
const save = app.getByRole('button', { name: 'Save' });
await expect(save).toBeAttached();
```

If no semantic tree is connected, a semantic locator fails with a capability
error. It never treats matching screen text as an element role.

## Where names and roles come from

An integration observes the framework's runtime state after a rendered frame.
Framework-native accessibility properties are used where available.

Some frameworks discard application-specific meaning before rendering. Their
Termwright SDK can annotate a component with a role, name, relationship, test
ID, or domain state. An annotation cannot replace observed physical state such
as focus, clipping, or pointer routing.

## Identity across frames

Retained UI frameworks usually provide a stable element identity. Immediate-
mode frameworks such as Ratatui and Bubble Tea reconstruct their UI on each
frame, so an ordinary element identity lasts for one frame. Use that
integration's semantic key when a locator must follow the same domain element
across updates.

Normal tests should keep declarative locators such as `getByRole()` rather than
storing a resolved reference.

## Visibility and clicking vary by framework

OpenTUI and Textual expose viewport geometry and exact pointer recipients.
Ink exposes clipped viewport geometry, but locator clicks need application
pointer setup. tview, Ratatui, and Bubble Tea require application pointer setup
and do not expose viewport clipping automatically.

Check the [framework compatibility table](../../reference/compatibility/) before
using visibility assertions or locator-based mouse input.

## Related pages

- [Choose a locator](../../guides/locators/)
- [Choose a framework integration](../../adapters/)
- [Geometry and visibility](../../reference/geometry-visibility/)
