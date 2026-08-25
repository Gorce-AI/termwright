---
title: "Interface: PtySpawnOptions"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtySpawnOptions

# Interface: PtySpawnOptions

Defined in: [pty.ts:14](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L14)

Options accepted by [PtyBackend.spawn](../ptybackend/#spawn).

## Properties

### columns

> `readonly` **columns**: `number`

Defined in: [pty.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L18)

***

### command

> `readonly` **command**: readonly `string`[]

Defined in: [pty.ts:15](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L15)

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [pty.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L16)

***

### env

> `readonly` **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [pty.ts:17](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L17)

***

### rows

> `readonly` **rows**: `number`

Defined in: [pty.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L19)

***

### term?

> `readonly` `optional` **term?**: `string`

Defined in: [pty.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L21)

`$TERM` for the child. Defaults to `xterm-256color`.
