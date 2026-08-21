---
title: "Interface: ResolvedTarget"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ResolvedTarget

# Interface: ResolvedTarget

Defined in: [driver/src/api.ts:594](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L594)

`@termwright/driver` — PTY + VT sessions, locators, actions and waits.

The normative public API lives in `api.ts`; this module is the only entry
point and re-exports the types from there together with their runtime
implementations.

## Example

```ts
import { launchTerminal } from '@termwright/driver';

const terminal = await launchTerminal({ command: ['node', 'app.js'] });
await terminal.waitForText('Ready');
await terminal.getByRole('button', { name: 'Approve' }).activate();
await terminal.close();
```

## Properties

### frameworkType?

> `readonly` `optional` **frameworkType?**: `string`

Defined in: [driver/src/api.ts:628](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L628)

The framework's own name for the widget, when the node carries one.

Required on `generic` nodes by the protocol, and the reason a `generic`
node is worth having: without it an unrecognised widget says only
"something was here".

***

### identity

> `readonly` **identity**: `"stable"` \| `"frame-local"`

Defined in: [driver/src/api.ts:620](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L620)

Whether a resolved target's `ref` means anything after this revision.

`'stable'` — the identity survives across frames, so the ref can be
re-resolved later and `locatorForRef` works. `'frame-local'` — the id is
an index into one frame and means nothing in the next; a probe for a
framework with no stable identity (Ratatui) says so at handshake time.

Re-resolving a frame-local ref would not answer "did this node change?"
but "what holds that number now?", which is how a passing test ends up
asserting about a widget it never selected.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [driver/src/api.ts:607](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L607)

***

### occlusion?

> `readonly` `optional` **occlusion?**: `"known"` \| `"unknown"`

Defined in: [driver/src/api.ts:639](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L639)

Whether the producer could tell what covers these cells.

`'known'` — paint order was observable, so [ResolvedTarget.rect](#rect) is
geometry the user can actually reach. Anything else, absence included,
means the rectangle is where the widget asked to draw and something may
be on top of it. Pointer actions refuse on anything but `'known'`.

***

### provenance?

> `readonly` `optional` **provenance?**: `"annotation"` \| `"recognizer"` \| `"framework"` \| `"correlation"` \| `"heuristic"`

Defined in: [driver/src/api.ts:630](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L630)

Where this node's facts came from, when the producer reported it.

***

### rect

> `readonly` **rect**: `Rect` \| `null`

Defined in: [driver/src/api.ts:605](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L605)

Rectangle used by the resolution/action pipeline. A semantic target only
exposes an evidence-qualified visible rectangle here; intended geometry is
never promoted to pointer ownership. Use [Locator.geometry](../locator/#geometry),
[Locator.visibility](../locator/#visibility), or [Locator.hitTest](../locator/#hittest) for assertions.

***

### ref

> `readonly` **ref**: `string`

Defined in: [driver/src/api.ts:596](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L596)

'n8@42' — node id at semantic revision, or a grid rect for generic matches.

***

### revision

> `readonly` **revision**: `number`

Defined in: [driver/src/api.ts:597](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L597)

***

### role?

> `readonly` `optional` **role?**: `"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

Defined in: [driver/src/api.ts:606](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L606)

***

### semantic

> `readonly` **semantic**: `boolean`

Defined in: [driver/src/api.ts:598](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L598)
