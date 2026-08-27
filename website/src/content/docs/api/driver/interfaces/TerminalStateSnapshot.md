---
title: "Interface: TerminalStateSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalStateSnapshot

# Interface: TerminalStateSnapshot

Defined in: [driver/src/api.ts:332](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L332)

One authoritative snapshot of terminal-emulator state.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:338](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L338)

***

### buffer

> `readonly` **buffer**: `"normal"` \| `"alternate"`

Defined in: [driver/src/api.ts:335](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L335)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:337](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L337)

***

### dimensions

> `readonly` **dimensions**: `object`

Defined in: [driver/src/api.ts:334](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L334)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [driver/src/api.ts:339](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L339)

***

### screenRevision

> `readonly` **screenRevision**: `number`

Defined in: [driver/src/api.ts:333](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L333)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:336](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L336)
