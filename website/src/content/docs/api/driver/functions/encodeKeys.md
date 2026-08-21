---
title: "Function: encodeKeys()"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / encodeKeys

# Function: encodeKeys()

> **encodeKeys**(`keys`, `modes`): `Uint8Array`

Defined in: [keys.ts:193](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/keys.ts#L193)

Encodes a key description into the bytes a terminal would send.

## Parameters

### keys

`string`

one or more chords, e.g. `'Control+A'` or `'Escape ArrowUp'`

### modes

[`KeyEncodingModes`](../../interfaces/keyencodingmodes/)

the child's current DECCKM/DECNKM state

## Returns

`Uint8Array`
