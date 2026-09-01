---
title: "Interface: PtyBackend"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyBackend

# Interface: PtyBackend

Defined in: [pty.ts:83](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L83)

Factory for pseudo-terminals.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [pty.ts:84](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L84)

## Methods

### spawn()

> **spawn**(`options`): [`PtyProcess`](../ptyprocess/)

Defined in: [pty.ts:85](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L85)

#### Parameters

##### options

[`PtySpawnOptions`](../ptyspawnoptions/)

#### Returns

[`PtyProcess`](../ptyprocess/)
