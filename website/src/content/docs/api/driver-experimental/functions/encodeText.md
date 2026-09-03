---
title: "Function: encodeText()"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / encodeText

# Function: encodeText()

> **encodeText**(`text`): `Uint8Array`

Defined in: [keys.ts:200](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/keys.ts#L200)

Encodes literal text as typed input: `\n` becomes carriage return, which is
what a terminal delivers when the Enter key is pressed.

## Parameters

### text

`string`

## Returns

`Uint8Array`
