---
title: "Function: encodeText()"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / encodeText

# Function: encodeText()

> **encodeText**(`text`, `modes?`): `Uint8Array`

Defined in: [keys.ts:285](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/keys.ts#L285)

Encodes literal text as typed input: `\n` becomes carriage return, which is
what a terminal delivers when the Enter key is pressed.

## Parameters

### text

`string`

### modes?

[`KeyEncodingModes`](../../interfaces/keyencodingmodes/)

## Returns

`Uint8Array`
