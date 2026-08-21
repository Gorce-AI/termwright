---
title: "Interface: ShellStatus"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellStatus

# Interface: ShellStatus

Defined in: [api.ts:210](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L210)

Observable shell-integration state; fields are never inferred from prompt text.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [api.ts:219](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L219)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [api.ts:218](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L218)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [api.ts:216](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L216)

Last OSC 7 working directory, or null when the child never published one.

***

### lastExitCode

> `readonly` **lastExitCode**: `number` \| `null`

Defined in: [api.ts:214](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L214)

***

### lastMark

> `readonly` **lastMark**: `"A"` \| `"B"` \| `"C"` \| `"D"` \| `null`

Defined in: [api.ts:213](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L213)

***

### ready

> `readonly` **ready**: `boolean`

Defined in: [api.ts:212](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L212)

***

### supported

> `readonly` **supported**: `boolean`

Defined in: [api.ts:211](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L211)

***

### title

> `readonly` **title**: `string`

Defined in: [api.ts:217](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L217)
