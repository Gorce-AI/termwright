---
title: "Function: debugMode()"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / debugMode

# Function: debugMode()

> **debugMode**(`explicit`): `"off"` \| `"api"` \| `"all"`

Defined in: [debug.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/debug.ts#L32)

Reads the debug switch. `TERMWRIGHT_DEBUG` accepts `1`, `true`, `api`
(calls, waits, revisions, diagnostics) and `all` (adds raw PTY traffic).

## Parameters

### explicit

`boolean` \| `undefined`

## Returns

`"off"` \| `"api"` \| `"all"`
