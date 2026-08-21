---
title: "Interface: ShellStatus"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellStatus

# Interface: ShellStatus

Defined in: [driver/src/api.ts:275](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L275)

Observable shell-integration state; fields are never inferred from prompt text.

## Properties

### bellCount

> `readonly` **bellCount**: `number`

Defined in: [driver/src/api.ts:284](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L284)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:283](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L283)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:281](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L281)

Last OSC 7 working directory, or null when the child never published one.

***

### lastExitCode

> `readonly` **lastExitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:279](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L279)

***

### lastMark

> `readonly` **lastMark**: `"A"` \| `"B"` \| `"C"` \| `"D"` \| `null`

Defined in: [driver/src/api.ts:278](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L278)

***

### ready

> `readonly` **ready**: `boolean`

Defined in: [driver/src/api.ts:277](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L277)

***

### supported

> `readonly` **supported**: `boolean`

Defined in: [driver/src/api.ts:276](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L276)

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:282](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L282)
