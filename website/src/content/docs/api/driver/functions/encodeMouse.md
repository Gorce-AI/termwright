---
title: "Function: encodeMouse()"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / encodeMouse

# Function: encodeMouse()

> **encodeMouse**(`event`, `modes`): `Uint8Array`

Defined in: [mouse.ts:81](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L81)

Encodes one mouse event.

## Parameters

### event

[`MouseEvent`](../../interfaces/mouseevent/)

the event in zero-based viewport coordinates

### modes

[`TerminalModes`](../../interfaces/terminalmodes/)

current tracking/encoding modes as observed on the wire

## Returns

`Uint8Array`

## Throws

UnsupportedActionError when the child has no mouse tracking enabled,
or when the coordinates cannot be expressed in the negotiated encoding.
