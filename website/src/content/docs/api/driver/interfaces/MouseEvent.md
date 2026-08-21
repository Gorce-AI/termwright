---
title: "Interface: MouseEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / MouseEvent

# Interface: MouseEvent

Defined in: [driver/src/mouse.ts:24](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L24)

One mouse event in viewport cell coordinates (zero-based).

## Properties

### button?

> `readonly` `optional` **button?**: [`MouseButton`](../../type-aliases/mousebutton/)

Defined in: [driver/src/mouse.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L28)

***

### column

> `readonly` **column**: `number`

Defined in: [driver/src/mouse.ts:27](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L27)

***

### dragging?

> `readonly` `optional` **dragging?**: `boolean`

Defined in: [driver/src/mouse.ts:34](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L34)

True while a button is held (motion events use the drag bit).

***

### kind

> `readonly` **kind**: `"press"` \| `"wheel"` \| `"move"` \| `"release"`

Defined in: [driver/src/mouse.ts:25](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L25)

***

### modifiers?

> `readonly` `optional` **modifiers?**: readonly (`"shift"` \| `"alt"` \| `"control"`)[]

Defined in: [driver/src/mouse.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L29)

***

### row

> `readonly` **row**: `number`

Defined in: [driver/src/mouse.ts:26](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L26)

***

### wheelAxis?

> `readonly` `optional` **wheelAxis?**: `"vertical"` \| `"horizontal"`

Defined in: [driver/src/mouse.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L32)

***

### wheelDelta?

> `readonly` `optional` **wheelDelta?**: `number`

Defined in: [driver/src/mouse.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L31)

Wheel direction; positive scrolls down, negative scrolls up.
