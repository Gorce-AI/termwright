---
title: "Interface: PtyBackend"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyBackend

# Interface: PtyBackend

Defined in: [pty.ts:86](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L86)

Factory for pseudo-terminals.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [pty.ts:87](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L87)

## Methods

### spawn()

> **spawn**(`options`): [`PtyProcess`](../ptyprocess/)

Defined in: [pty.ts:88](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L88)

#### Parameters

##### options

[`PtySpawnOptions`](../ptyspawnoptions/)

#### Returns

[`PtyProcess`](../ptyprocess/)
