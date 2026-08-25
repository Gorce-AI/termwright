---
title: "Function: encodeMouse()"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / encodeMouse

# Function: encodeMouse()

> **encodeMouse**(`event`, `modes`): `Uint8Array`

Defined in: [mouse.ts:99](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/mouse.ts#L99)

Encodes one mouse event.

## Parameters

### event

[`MouseEvent`](../../interfaces/mouseevent/)

the event in zero-based viewport coordinates

### modes

`TerminalModes`

current tracking/encoding modes as observed on the wire

## Returns

`Uint8Array`

## Throws

InputModeDisabledError when the child has no mouse tracking enabled,
or when the coordinates cannot be expressed in the negotiated encoding.
