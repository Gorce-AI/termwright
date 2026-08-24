---
title: "Function: resolveDefaultPtyBackend()"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / resolveDefaultPtyBackend

# Function: resolveDefaultPtyBackend()

> **resolveDefaultPtyBackend**(`platform?`): `Promise`\<[`PtyBackendChoice`](../../interfaces/ptybackendchoice/)\>

Defined in: [driver/src/backend-selection.ts:88](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/backend-selection.ts#L88)

The backend a session uses when its caller did not supply one.

Resolved once per process: the answer depends on the machine, not on the
session, and probing a native module for every terminal would be a cost paid
repeatedly for a constant.

## Parameters

### platform?

`Platform` = `process.platform`

## Returns

`Promise`\<[`PtyBackendChoice`](../../interfaces/ptybackendchoice/)\>
