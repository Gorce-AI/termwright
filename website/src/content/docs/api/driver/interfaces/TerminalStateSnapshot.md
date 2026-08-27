---
title: "Interface: TerminalStateSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalStateSnapshot

# Interface: TerminalStateSnapshot

Defined in: [driver/src/api.ts:321](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L321)

One authoritative snapshot of terminal-emulator state.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:327](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L327)

***

### buffer

> `readonly` **buffer**: `"normal"` \| `"alternate"`

Defined in: [driver/src/api.ts:324](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L324)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:326](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L326)

***

### dimensions

> `readonly` **dimensions**: `object`

Defined in: [driver/src/api.ts:323](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L323)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [driver/src/api.ts:328](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L328)

***

### screenRevision

> `readonly` **screenRevision**: `number`

Defined in: [driver/src/api.ts:322](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L322)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:325](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L325)
