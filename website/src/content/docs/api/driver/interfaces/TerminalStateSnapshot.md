---
title: "Interface: TerminalStateSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalStateSnapshot

# Interface: TerminalStateSnapshot

Defined in: [driver/src/api.ts:350](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L350)

One authoritative snapshot of terminal-emulator state.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:356](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L356)

***

### buffer

> `readonly` **buffer**: `"normal"` \| `"alternate"`

Defined in: [driver/src/api.ts:353](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L353)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:355](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L355)

***

### dimensions

> `readonly` **dimensions**: `object`

Defined in: [driver/src/api.ts:352](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L352)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [driver/src/api.ts:357](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L357)

***

### screenRevision

> `readonly` **screenRevision**: `number`

Defined in: [driver/src/api.ts:351](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L351)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:354](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L354)
