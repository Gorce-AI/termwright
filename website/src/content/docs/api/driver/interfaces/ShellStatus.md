---
title: "Interface: ShellStatus"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellStatus

# Interface: ShellStatus

Defined in: [driver/src/api.ts:339](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L339)

Observable shell-integration state; fields are never inferred from prompt text.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:348](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L348)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:347](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L347)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:345](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L345)

Last OSC 7 working directory, or null when the child never published one.

***

### lastExitCode

> `readonly` **lastExitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:343](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L343)

***

### lastMark

> `readonly` **lastMark**: `"A"` \| `"B"` \| `"C"` \| `"D"` \| `null`

Defined in: [driver/src/api.ts:342](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L342)

***

### ready

> `readonly` **ready**: `boolean`

Defined in: [driver/src/api.ts:341](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L341)

***

### supported

> `readonly` **supported**: `boolean`

Defined in: [driver/src/api.ts:340](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L340)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:346](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L346)
