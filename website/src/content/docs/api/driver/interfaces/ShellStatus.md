---
title: "Interface: ShellStatus"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellStatus

# Interface: ShellStatus

Defined in: [driver/src/api.ts:280](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L280)

Observable shell-integration state; fields are never inferred from prompt text.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:289](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L289)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:288](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L288)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:286](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L286)

Last OSC 7 working directory, or null when the child never published one.

***

### lastExitCode

> `readonly` **lastExitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:284](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L284)

***

### lastMark

> `readonly` **lastMark**: `"A"` \| `"B"` \| `"C"` \| `"D"` \| `null`

Defined in: [driver/src/api.ts:283](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L283)

***

### ready

> `readonly` **ready**: `boolean`

Defined in: [driver/src/api.ts:282](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L282)

***

### supported

> `readonly` **supported**: `boolean`

Defined in: [driver/src/api.ts:281](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L281)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:287](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L287)
