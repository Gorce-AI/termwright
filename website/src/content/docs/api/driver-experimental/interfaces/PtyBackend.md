---
title: "Interface: PtyBackend"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyBackend

# Interface: PtyBackend

Defined in: [pty.ts:98](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L98)

Factory for pseudo-terminals.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [pty.ts:99](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L99)

## Methods

### spawn()

> **spawn**(`options`): [`PtyProcess`](../ptyprocess/)

Defined in: [pty.ts:100](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L100)

#### Parameters

##### options

[`PtySpawnOptions`](../ptyspawnoptions/)

#### Returns

[`PtyProcess`](../ptyprocess/)
