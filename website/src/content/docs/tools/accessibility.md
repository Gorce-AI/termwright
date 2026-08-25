---
title: Runner accessibility
description: Keyboard navigation, focus behavior, status communication, and reduced motion in Runner UI.
---

Runner supports keyboard navigation for its primary workflows. Status is
communicated with text and icons as well as color.

## Navigate without a pointer

- In the Semantic Inspector and Specs catalogue, Up and Down move through the
  visible tree rows, while Home and End move to the first and last visible row.
- Right expands a collapsed branch, then moves to its first child. Left
  collapses an expanded branch, then moves to its parent.
- Each tree has exactly one item in the page tab order. Focus and selection
  move together and remain on the same item when live data re-renders the tree.
- Enter and Space activate the focused semantic node. In Specs they expand a
  directory or file, or run a runnable case. `R` runs the focused Specs scope;
  `O` opens source for a focused case.
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

The semantic inspector and Specs catalogue use the `tree`, `treeitem`, and
`group` patterns and share the same navigation implementation.
Selecting a node updates its readable property view without requiring pointer
input. Protocol state is mapped to ARIA only when the corresponding attribute
is valid.

Automated browser tests cover roles, names, keyboard interaction, focus order,
and dialog behavior. They complement, rather than replace, checks with
VoiceOver, NVDA, or another screen reader.

Termwright does not make the application inside the terminal directly
available to platform screen readers. Emulator and bridge authors can use the
advanced [AccessKit export](../../reference/accessibility/).
