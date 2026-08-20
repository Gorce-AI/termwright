---
title: Accessibility
description: Keyboard and screen-reader behavior in Runner UI, plus the AccessKit tree export.
---

This page covers accessibility of the Termwright Runner and the optional export
of a terminal application's semantic tree. Termwright does not make an
application running inside a terminal directly available to platform screen
readers.

## Runner UI accessibility

Runner uses native controls and ARIA composite patterns for its navigation,
execution tree, tabs, dialogs, splitters, and inspector. Keyboard interaction
includes:

- arrow, Home, and End navigation in composite lists and trees;
- Enter and Space activation;
- keyboard-operated splitters;
- trapped focus and Escape dismissal in modal dialogs;
- focus restoration when a dialog or popover closes.

Status is communicated with text and icons as well as color. Reduced motion can
follow the operating system or be enabled in Settings.

Automated browser tests verify roles, names, focus order, keyboard interaction,
and computed accessibility-tree structure. They do not replace testing with
VoiceOver, NVDA, or another screen reader.

## Semantic inspector accessibility

The inspector maps protocol roles and state to ARIA only where the corresponding
ARIA attribute is valid. Attributes are removed when state changes. Decorative
role captions are hidden from assistive technology.

The tree uses the `tree` / `treeitem` / `group` pattern. Selecting a node updates
the readable property view without requiring pointer input.

## Export an AccessKit tree

Adapter and emulator authors can convert a `SemanticSnapshot` to AccessKit's
serde-compatible `TreeUpdate` shape:

```ts
import {toAccessKitTreeUpdate} from '@termwright/protocol';

const {update, cellBounds} = toAccessKitTreeUpdate(snapshot, {
  toolkitName: 'ink',
  toolkitVersion: '7.1.1',
});
```

`@termwright/protocol` does not depend on AccessKit. The function returns data
for a platform bridge to consume.

Terminal geometry is measured in cells. AccessKit geometry is measured in
pixels relative to a native window. Pass `cellSize` only when the caller owns
the emulator window and knows its cell metrics:

```ts
const result = toAccessKitTreeUpdate(snapshot, {
  cellSize: {width: 8, height: 16},
});
```

Without `cellSize`, the export keeps cell rectangles in `cellBounds` and omits
pixel bounds from AccessKit nodes.

## Current boundary

The export is not a native accessibility bridge. A platform bridge must own a
native window, pixel geometry, focus routing, and action dispatch. Terminal
applications normally own none of those directly because the emulator owns the
window.

Use the export when building an emulator or accessibility bridge. Use the
Runner's semantic inspector when testing roles, names, state, and hierarchy.
