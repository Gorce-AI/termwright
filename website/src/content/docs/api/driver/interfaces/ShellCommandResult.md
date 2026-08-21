---
title: "Interface: ShellCommandResult"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellCommandResult

# Interface: ShellCommandResult

Defined in: [driver/src/api.ts:293](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L293)

One command, bounded by the shell's OSC 133 C and D marks.

## Properties

### command

> `readonly` **command**: `string`

Defined in: [driver/src/api.ts:294](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L294)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [driver/src/api.ts:298](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L298)

***

### exitCode

> `readonly` **exitCode**: `number` \| `null`

Defined in: [driver/src/api.ts:297](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L297)

***

### output

> `readonly` **output**: `string`

Defined in: [driver/src/api.ts:296](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L296)

Exact terminal bytes emitted between command-start and command-end marks.

***

### receipt

> `readonly` **receipt**: [`ActionReceipt`](../actionreceipt/)

Defined in: [driver/src/api.ts:301](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L301)

The exact physical keyboard plan that submitted this command.

***

### title

> `readonly` **title**: `string`

Defined in: [driver/src/api.ts:299](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L299)
