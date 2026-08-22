---
title: "Interface: PtyBackend"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / PtyBackend

# Interface: PtyBackend

Defined in: [driver/src/pty.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L69)

Factory for pseudo-terminals.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [driver/src/pty.ts:70](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L70)

## Methods

### spawn()

> **spawn**(`options`): [`PtyProcess`](../ptyprocess/)

Defined in: [driver/src/pty.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L71)

#### Parameters

##### options

[`PtySpawnOptions`](../ptyspawnoptions/)

#### Returns

[`PtyProcess`](../ptyprocess/)
