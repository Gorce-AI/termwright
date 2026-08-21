---
title: "Function: encodeText()"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / encodeText

# Function: encodeText()

> **encodeText**(`text`): `Uint8Array`

Defined in: [keys.ts:204](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/keys.ts#L204)

Encodes literal text as typed input: `\n` becomes carriage return, which is
what a terminal delivers when the Enter key is pressed.

## Parameters

### text

`string`

## Returns

`Uint8Array`
