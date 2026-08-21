---
title: "Interface: TerminalStateSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalStateSnapshot

# Interface: TerminalStateSnapshot

Defined in: [driver/src/api.ts:259](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L259)

One authoritative snapshot of terminal-emulator state.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:265](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L265)

***

### buffer

> `readonly` **buffer**: `"normal"` \| `"alternate"`

Defined in: [driver/src/api.ts:262](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L262)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:264](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L264)

***

### dimensions

> `readonly` **dimensions**: `object`

Defined in: [driver/src/api.ts:261](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L261)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [driver/src/api.ts:266](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L266)

***

### screenRevision

> `readonly` **screenRevision**: `number`

Defined in: [driver/src/api.ts:260](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L260)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:263](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L263)
