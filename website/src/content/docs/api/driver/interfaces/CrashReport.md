---
title: "Interface: CrashReport"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CrashReport

# Interface: CrashReport

Defined in: [api.ts:651](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L651)

What the session knew at the moment a program died unexpectedly.

"Unexpectedly" means the child exited on a signal, or with a non-zero code,
without the harness being asked for it: neither `close()` nor an explicit
`signal()` produces a report.

## Properties

### diagnosticsTail

> `readonly` **diagnosticsTail**: readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

Defined in: [api.ts:667](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L667)

Tail of the session diagnostics log.

***

### exit

> `readonly` **exit**: [`ExitStatus`](../exitstatus/)

Defined in: [api.ts:652](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L652)

***

### lastSemanticTree

> `readonly` **lastSemanticTree**: `SemanticSnapshot` \| `null`

Defined in: [api.ts:663](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L663)

Last fully paired semantic revision, when the session had one.

***

### recentInputs

> `readonly` **recentInputs**: readonly [`CrashInput`](../crashinput/)[]

Defined in: [api.ts:665](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L665)

The most recent inputs, oldest first — what was sent just before the end.

***

### screenTail

> `readonly` **screenTail**: readonly `string`[]

Defined in: [api.ts:661](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L661)

Last lines of scrollback plus the visible grid, oldest first, with trailing
blank lines trimmed — where a stack trace or a panic message ends up.

This is what the terminal showed, verbatim and unscrubbed: whatever the
program (or the tty's echo) displayed is here, secrets included. Treat a
crash report like a screenshot when storing or forwarding it.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [api.ts:669](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L669)

Milliseconds since session start, on the same clock as every event.
