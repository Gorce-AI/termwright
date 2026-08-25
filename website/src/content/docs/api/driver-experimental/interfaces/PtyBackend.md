---
title: "Interface: PtyBackend"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyBackend

# Interface: PtyBackend

Defined in: [pty.ts:92](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L92)

Factory for pseudo-terminals.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [pty.ts:93](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L93)

## Methods

### spawn()

> **spawn**(`options`): [`PtyProcess`](../ptyprocess/)

Defined in: [pty.ts:94](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L94)

#### Parameters

##### options

[`PtySpawnOptions`](../ptyspawnoptions/)

#### Returns

[`PtyProcess`](../ptyprocess/)
