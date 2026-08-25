---
title: "Function: ptyUnavailableReason()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / ptyUnavailableReason

# Function: ptyUnavailableReason()

> **ptyUnavailableReason**(): [`PtyUnavailableReason`](../../interfaces/ptyunavailablereason/) \| `undefined`

Defined in: [test/src/pty-available.ts:66](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/pty-available.ts#L66)

Why the last probe answered `false`, or undefined if it answered `true`.

Resolve [ptyAvailable](../ptyavailable/) before reading this: the answer is produced by
the probe.

## Returns

[`PtyUnavailableReason`](../../interfaces/ptyunavailablereason/) \| `undefined`
