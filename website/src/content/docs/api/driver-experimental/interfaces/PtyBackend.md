---
title: "Interface: PtyBackend"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyBackend

# Interface: PtyBackend

Defined in: [pty.ts:70](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L70)

Factory for pseudo-terminals.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [pty.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L71)

## Methods

### spawn()

> **spawn**(`options`): [`PtyProcess`](../ptyprocess/)

Defined in: [pty.ts:72](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L72)

#### Parameters

##### options

[`PtySpawnOptions`](../ptyspawnoptions/)

#### Returns

[`PtyProcess`](../ptyprocess/)
