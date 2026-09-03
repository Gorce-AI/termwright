---
title: Geometry, visibility, and pointer support
description: Understand terminal coordinates, visibility assertions, and the framework support needed for locator clicks.
---

Geometry tells you where an element is intended to appear and which part lies
inside the terminal viewport. Pointer support additionally tells you which
element will receive a mouse event at a cell.

These are separate because a layout rectangle can be covered, clipped, or
handled by another element.

## Use visibility matchers

```ts
await expect(panel).toBeDisplayed();
await expect(panel).toBeVisible();
await expect(panel).toBeInViewport({ fully: true });
await expect(panel).toBeOffscreen();
```

- **Attached** means the element exists in the semantic tree.
- **Displayed** means the framework intends to lay it out or paint it.
- **Visible** means a known portion lies in the terminal viewport.
- **Offscreen** means the element is displayed but has no visible viewport
  intersection.

An integration that cannot observe viewport clipping reports visibility as
unsupported. Neither `toBeVisible()` nor `not.toBeVisible()` passes in that
case. Use `toBeAttached()` only when element existence is the behavior you want
to test.

## Assert bounds and layout

```ts
await expect(card).toHaveBounds({ column: 2, row: 4, width: 40, height: 8 });
await expect(label).toHaveSpatialRelation({
  relation: 'left-of',
  target: input,
});
```

Terminal coordinates are zero-based. Rectangles use an exclusive far edge: a
rectangle at column 2 with width 3 occupies columns 2, 3, and 4.

Spatial assertions require both locators to belong to the same terminal session
and coordinate space. Use them for layout behavior such as responsive panes,
clipping, scrolling, or alignment—not incidental decoration.

## Click by locator

```ts
await app.getByRole('button', { name: 'Save' }).click();
```

A locator click requires both:

1. the application has enabled terminal mouse reporting; and
2. the framework integration can identify the cells routed to the element.

Some integrations provide this automatically. Others need the application to
connect its production pointer router. A plain geometry rectangle does not
enable clicking.

<!-- geometry-matrices:start -->
## Framework support

This table is generated from the integration registry. “Application setup” links the framework integration to pointer or focus behavior already implemented by the application.

| Framework | Role locators | Viewport visibility | Click by locator | Focus by locator | Type by locator |
| --- | --- | --- | --- | --- | --- |
| Ink | Yes | Yes | Application setup | Yes | Application setup |
| OpenTUI | Yes | Yes | Yes | Yes | Yes |
| Textual | Yes | Yes | Yes | Yes | Yes |
| tview | Yes | No | Application setup | Yes | Yes |
| Ratatui | Yes | No | Application setup | Yes | Application setup |
| Bubble Tea / Bubbles | Yes | No | Application setup | Yes | Yes |
<!-- geometry-matrices:end -->

“No” applies to the semantic operation. Keyboard input and raw coordinate mouse
input remain available for the terminal session.

## Read geometry directly

Advanced code can call `locator.geometry()`, `locator.visibility()`, and
`locator.hitTest()`. The result distinguishes:

- a known value;
- an element known to be absent or not displayed;
- a value that is temporarily unknown while the UI changes; and
- behavior the integration does not support.

Most tests should use matchers. They wait through temporary UI changes and
report unsupported behavior immediately.

## Resize and assert separately

```ts
await app.resize({ columns: 120, rows: 40 });
await expect(app.getByRole('navigation')).toBeVisible();
```

`resize()` confirms the PTY and emulator dimensions. An instrumented adapter
can also prove the paired application render in the returned receipt; a generic
terminal cannot distinguish a resize repaint from unrelated output. The
assertion above is the application-level proof of the resulting layout.

## Related pages

- [Choose a locator](../../guides/locators/)
- [Send input](../../guides/actions/)
- [Framework compatibility](../compatibility/)
