---
title: "Function: createNativePtyBackend()"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / createNativePtyBackend

# Function: createNativePtyBackend()

> **createNativePtyBackend**(`spawn?`, `platform?`): [`PtyBackend`](../../interfaces/ptybackend/)

Defined in: [native-pty-backend.ts:58](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L58)

Adapts the native package without adding lifecycle policy or weaker fallbacks.
The package owns EOF, process groups/jobs and ordered writes; this layer only
preserves early events until TerminalSession has attached its journal.

## Parameters

### spawn?

[`NativePtySpawn`](../../type-aliases/nativeptyspawn/) = `spawnNativePty`

### platform?

`Platform` = `process.platform`

## Returns

[`PtyBackend`](../../interfaces/ptybackend/)
