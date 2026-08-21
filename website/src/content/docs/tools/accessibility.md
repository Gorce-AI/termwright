---
title: Runner accessibility
description: Keyboard navigation, focus behavior, status communication, and reduced motion in Runner UI.
---

Runner supports keyboard navigation for its primary workflows. Status is
communicated with text and icons as well as color.

## Navigate without a pointer

- Arrow keys, Home, and End move through composite lists and trees.
- Enter and Space activate the focused item.
- Splitters can be resized from the keyboard.
- Dialogs trap focus, close with Escape, and restore focus to their trigger.
- Tabs and the semantic tree expose their selected and expanded state.

Icon-only controls have accessible names and visible tooltips. The execution
list uses blue plus a running indicator for active cases; green is reserved for
completed passes.

## Reduce motion

Runner follows the operating-system reduced-motion preference by default. A
workspace override is available in Settings and applies immediately to
transitions and replay animation.

## Inspect semantic state

The semantic inspector uses the `tree`, `treeitem`, and `group` patterns.
Selecting a node updates its readable property view without requiring pointer
input. Protocol state is mapped to ARIA only when the corresponding attribute
is valid.

Automated browser tests cover roles, names, keyboard interaction, focus order,
and dialog behavior. They complement, rather than replace, checks with
VoiceOver, NVDA, or another screen reader.

Termwright does not make the application inside the terminal directly
available to platform screen readers. Emulator and bridge authors can use the
advanced [AccessKit export](../../reference/accessibility/).
