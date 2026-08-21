---
title: "Interface: ShellCommandResult"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellCommandResult

# Interface: ShellCommandResult

Defined in: [api.ts:228](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L228)

One command, bounded by the shell's OSC 133 C and D marks.

## Properties

### command

> `readonly` **command**: `string`

Defined in: [api.ts:229](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L229)

***

### cwd

> `readonly` **cwd**: `string` \| `null`

Defined in: [api.ts:233](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L233)

***

### exitCode

> `readonly` **exitCode**: `number` \| `null`

Defined in: [api.ts:232](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L232)

***

### output

> `readonly` **output**: `string`

Defined in: [api.ts:231](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L231)

Exact terminal bytes emitted between command-start and command-end marks.

***

### title

> `readonly` **title**: `string`

Defined in: [api.ts:234](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L234)
