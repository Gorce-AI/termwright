---
title: "Interface: ShellCommandResult"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellCommandResult

# Interface: ShellCommandResult

Defined in: [driver/src/api.ts:366](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L366)

One command, bounded by the shell's OSC 133 C and D marks.

## Properties

### command

> `readonly` **command**: `string`

Defined in: [driver/src/api.ts:367](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L367)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:371](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L371)

***

### exitCode

> `readonly` **exitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:370](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L370)

***

### output

> `readonly` **output**: `string`

Defined in: [driver/src/api.ts:369](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L369)

Exact terminal bytes emitted between command-start and command-end marks.

***

### receipt

> `readonly` **receipt**: [`ActionReceipt`](../actionreceipt/)

Defined in: [driver/src/api.ts:374](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L374)

The exact physical keyboard plan that submitted this command.

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:372](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L372)
