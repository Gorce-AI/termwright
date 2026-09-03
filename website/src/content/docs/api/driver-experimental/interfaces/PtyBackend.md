---
title: "Interface: PtyBackend"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyBackend

# Interface: PtyBackend

Defined in: [pty.ts:88](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L88)

Factory for pseudo-terminals.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [pty.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L89)

## Methods

### spawn()

> **spawn**(`options`): [`PtyProcess`](../ptyprocess/)

Defined in: [pty.ts:90](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L90)

#### Parameters

##### options

[`PtySpawnOptions`](../ptyspawnoptions/)

#### Returns

[`PtyProcess`](../ptyprocess/)
