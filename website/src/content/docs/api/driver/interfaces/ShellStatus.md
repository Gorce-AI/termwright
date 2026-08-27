---
title: "Interface: ShellStatus"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellStatus

# Interface: ShellStatus

Defined in: [driver/src/api.ts:348](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L348)

Observable shell-integration state; fields are never inferred from prompt text.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:357](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L357)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:356](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L356)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:354](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L354)

Last OSC 7 working directory, or null when the child never published one.

***

### lastExitCode

> `readonly` **lastExitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:352](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L352)

***

### lastMark

> `readonly` **lastMark**: `"A"` \| `"B"` \| `"C"` \| `"D"` \| `null`

Defined in: [driver/src/api.ts:351](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L351)

***

### ready

> `readonly` **ready**: `boolean`

Defined in: [driver/src/api.ts:350](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L350)

***

### supported

> `readonly` **supported**: `boolean`

Defined in: [driver/src/api.ts:349](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L349)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:355](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L355)
