---
title: "Interface: ShellStatus"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellStatus

# Interface: ShellStatus

Defined in: [driver/src/api.ts:366](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L366)

Observable shell-integration state; fields are never inferred from prompt text.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:375](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L375)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:374](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L374)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:372](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L372)

Last OSC 7 working directory, or null when the child never published one.

***

### lastExitCode

> `readonly` **lastExitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:370](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L370)

***

### lastMark

> `readonly` **lastMark**: `"A"` \| `"B"` \| `"C"` \| `"D"` \| `null`

Defined in: [driver/src/api.ts:369](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L369)

***

### ready

> `readonly` **ready**: `boolean`

Defined in: [driver/src/api.ts:368](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L368)

***

### supported

> `readonly` **supported**: `boolean`

Defined in: [driver/src/api.ts:367](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L367)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:373](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L373)
