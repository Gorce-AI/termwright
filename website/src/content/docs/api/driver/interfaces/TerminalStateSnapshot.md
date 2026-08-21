---
title: "Interface: TerminalStateSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalStateSnapshot

# Interface: TerminalStateSnapshot

Defined in: [driver/src/api.ts:264](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L264)

One authoritative snapshot of terminal-emulator state.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:270](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L270)

***

### buffer

> `readonly` **buffer**: `"normal"` \| `"alternate"`

Defined in: [driver/src/api.ts:267](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L267)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:269](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L269)

***

### dimensions

> `readonly` **dimensions**: `object`

Defined in: [driver/src/api.ts:266](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L266)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [driver/src/api.ts:271](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L271)

***

### screenRevision

> `readonly` **screenRevision**: `number`

Defined in: [driver/src/api.ts:265](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L265)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:268](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L268)
