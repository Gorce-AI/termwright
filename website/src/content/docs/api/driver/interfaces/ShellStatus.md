---
title: "Interface: ShellStatus"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellStatus

# Interface: ShellStatus

Defined in: [driver/src/api.ts:401](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L401)

Observable shell-integration state; fields are never inferred from prompt text.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:410](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L410)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:409](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L409)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:407](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L407)

Last OSC 7 working directory, or null when the child never published one.

***

### lastExitCode

> `readonly` **lastExitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:405](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L405)

***

### lastMark

> `readonly` **lastMark**: `"A"` \| `"B"` \| `"C"` \| `"D"` \| `null`

Defined in: [driver/src/api.ts:404](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L404)

***

### ready

> `readonly` **ready**: `boolean`

Defined in: [driver/src/api.ts:403](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L403)

***

### supported

> `readonly` **supported**: `boolean`

Defined in: [driver/src/api.ts:402](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L402)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:408](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L408)
