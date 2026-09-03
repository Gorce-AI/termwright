---
title: "Interface: ShellCommandResult"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellCommandResult

# Interface: ShellCommandResult

Defined in: [driver/src/api.ts:384](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L384)

One command, bounded by the shell's OSC 133 C and D marks.

## Properties

### command

> `readonly` **command**: `string`

Defined in: [driver/src/api.ts:385](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L385)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:389](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L389)

***

### exitCode

> `readonly` **exitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:388](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L388)

***

### output

> `readonly` **output**: `string`

Defined in: [driver/src/api.ts:387](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L387)

Exact terminal bytes emitted between command-start and command-end marks.

***

### receipt

> `readonly` **receipt**: [`ActionReceipt`](../actionreceipt/)

Defined in: [driver/src/api.ts:392](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L392)

The exact physical keyboard plan that submitted this command.

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:390](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L390)
