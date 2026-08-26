---
title: "Interface: PtySpawnOptions"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtySpawnOptions

# Interface: PtySpawnOptions

Defined in: [pty.ts:5](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L5)

Options accepted by [PtyBackend.spawn](../ptybackend/#spawn).

## Properties

### columns

> `readonly` **columns**: `number`

Defined in: [pty.ts:9](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L9)

***

### command

> `readonly` **command**: readonly `string`[]

Defined in: [pty.ts:6](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L6)

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [pty.ts:7](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L7)

***

### env

> `readonly` **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [pty.ts:8](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L8)

***

### rows

> `readonly` **rows**: `number`

Defined in: [pty.ts:10](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L10)

***

### term?

> `readonly` `optional` **term?**: `string`

Defined in: [pty.ts:12](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L12)

`$TERM` for the child. Defaults to `xterm-256color`.
