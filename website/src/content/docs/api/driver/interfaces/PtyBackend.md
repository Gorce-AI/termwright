---
title: "Interface: PtyBackend"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / PtyBackend

# Interface: PtyBackend

Defined in: [pty.ts:42](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L42)

Factory for pseudo-terminals.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [pty.ts:43](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L43)

## Methods

### spawn()

> **spawn**(`options`): [`PtyProcess`](../ptyprocess/)

Defined in: [pty.ts:44](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L44)

#### Parameters

##### options

[`PtySpawnOptions`](../ptyspawnoptions/)

#### Returns

[`PtyProcess`](../ptyprocess/)
