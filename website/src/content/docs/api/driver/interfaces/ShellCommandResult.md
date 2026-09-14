---
title: "Interface: ShellCommandResult"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellCommandResult

# Interface: ShellCommandResult

Defined in: [driver/src/api.ts:419](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L419)

One command, bounded by the shell's OSC 133 C and D marks.

## Properties

### command

> `readonly` **command**: `string`

Defined in: [driver/src/api.ts:420](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L420)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:424](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L424)

***

### exitCode

> `readonly` **exitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:423](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L423)

***

### output

> `readonly` **output**: `string`

Defined in: [driver/src/api.ts:422](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L422)

Exact terminal bytes emitted between command-start and command-end marks.

***

### receipt

> `readonly` **receipt**: [`ActionReceipt`](../actionreceipt/)

Defined in: [driver/src/api.ts:427](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L427)

The exact physical keyboard plan that submitted this command.

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:425](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L425)
