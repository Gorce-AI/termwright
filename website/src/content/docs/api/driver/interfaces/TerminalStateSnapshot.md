---
title: "Interface: TerminalStateSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalStateSnapshot

# Interface: TerminalStateSnapshot

Defined in: [driver/src/api.ts:385](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L385)

One authoritative snapshot of terminal-emulator state.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:391](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L391)

***

### buffer

> `readonly` **buffer**: `"normal"` \| `"alternate"`

Defined in: [driver/src/api.ts:388](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L388)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:390](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L390)

***

### dimensions

> `readonly` **dimensions**: `object`

Defined in: [driver/src/api.ts:387](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L387)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [driver/src/api.ts:392](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L392)

***

### screenRevision

> `readonly` **screenRevision**: `number`

Defined in: [driver/src/api.ts:386](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L386)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:389](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L389)
