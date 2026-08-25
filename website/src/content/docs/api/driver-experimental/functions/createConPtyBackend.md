---
title: "Function: createConPtyBackend()"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / createConPtyBackend

# Function: createConPtyBackend()

> **createConPtyBackend**(`spawn`): [`PtyBackend`](../../interfaces/ptybackend/)

Defined in: [conpty-backend.ts:63](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L63)

Wraps a ConPTY session as a driver backend.

Signals are the one place a translation could lie. Windows has no signal
delivery, and inventing one would let a caller believe a `TERM` was received
and declined. Only `KILL` maps to anything — terminating the owned tree — and
the rest are refused loudly rather than silently dropped, because a test that
thinks it asked for a graceful shutdown and got nothing is worse off than one
told the platform has no such thing.

## Parameters

### spawn

[`ConPtySpawn`](../../type-aliases/conptyspawn/)

## Returns

[`PtyBackend`](../../interfaces/ptybackend/)
