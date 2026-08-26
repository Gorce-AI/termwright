---
title: "Interface: ShellCommandResult"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellCommandResult

# Interface: ShellCommandResult

Defined in: [driver/src/api.ts:359](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L359)

One command, bounded by the shell's OSC 133 C and D marks.

## Properties

### command

> `readonly` **command**: `string`

Defined in: [driver/src/api.ts:360](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L360)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:364](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L364)

***

### exitCode

> `readonly` **exitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:363](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L363)

***

### output

> `readonly` **output**: `string`

Defined in: [driver/src/api.ts:362](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L362)

Exact terminal bytes emitted between command-start and command-end marks.

***

### receipt

> `readonly` **receipt**: [`ActionReceipt`](../actionreceipt/)

Defined in: [driver/src/api.ts:367](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L367)

The exact physical keyboard plan that submitted this command.

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:365](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L365)
