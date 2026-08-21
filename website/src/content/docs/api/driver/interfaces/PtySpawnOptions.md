---
title: "Interface: PtySpawnOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / PtySpawnOptions

# Interface: PtySpawnOptions

Defined in: [driver/src/pty.ts:11](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L11)

Options accepted by [PtyBackend.spawn](../ptybackend/#spawn).

## Properties

### columns

> `readonly` **columns**: `number`

Defined in: [driver/src/pty.ts:15](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L15)

***

### command

> `readonly` **command**: readonly `string`[]

Defined in: [driver/src/pty.ts:12](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L12)

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [driver/src/pty.ts:13](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L13)

***

### env

> `readonly` **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [driver/src/pty.ts:14](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L14)

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/pty.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L16)

***

### term?

> `readonly` `optional` **term?**: `string`

Defined in: [driver/src/pty.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L18)

`$TERM` for the child. Defaults to `xterm-256color`.
