---
title: AccessKit export
description: Convert semantic snapshots into AccessKit data for an emulator or platform bridge.
---

Emulator and platform-bridge authors can convert a `SemanticSnapshot` to AccessKit's
serde-compatible `TreeUpdate` shape:

```ts
import { toAccessKitTreeUpdate } from '@termwright/protocol';

const { update, cellBounds } = toAccessKitTreeUpdate(snapshot, {
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
  cellSize: { width: 8, height: 16 },
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
