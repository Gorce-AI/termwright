---
title: "Interface: PtyProcess"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyProcess

# Interface: PtyProcess

Defined in: [pty.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L19)

A live pseudo-terminal hosting one child process.

## Properties

### lifecycle?

> `readonly` `optional` **lifecycle?**: `object`

Defined in: [pty.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L22)

Truthful lifecycle properties when the backend can prove them.

#### outputDrain

> `readonly` **outputDrain**: `"eof"` \| `"bounded-fallback"`

#### tree

> `readonly` **tree**: `"posix-process-group"` \| `"conpty-console"` \| `"delegated"`

***

### outputEnded?

> `readonly` `optional` **outputEnded?**: `Promise`\<`void`\>

Defined in: [pty.ts:58](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L58)

Settles once the backend's output producer can deliver no more bytes.

***

### pid

> `readonly` **pid**: `number`

Defined in: [pty.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L20)

***

### sawOutputEnd?

> `readonly` `optional` **sawOutputEnd?**: () => `boolean`

Defined in: [pty.ts:63](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L63)

Whether the producer reached its authoritative EOF rather than being torn
down with bytes potentially unread. `outputEnded` settles in both cases.

#### Returns

`boolean`

## Methods

### attach()?

> `optional` **attach**(`signal`): `Promise`\<`void`\>

Defined in: [pty.ts:65](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L65)

Settles once an asynchronously created native session is ready for lifecycle operations.

#### Parameters

##### signal

`AbortSignal`

#### Returns

`Promise`\<`void`\>

***

### dispose()

> **dispose**(): `void`

Defined in: [pty.ts:73](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L73)

Idempotent finalizer; hangs up a live PTY before releasing listeners.

#### Returns

`void`

***

### hardKillTree()?

> `optional` **hardKillTree**(`signal`): `Promise`\<`void`\>

Defined in: [pty.ts:54](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L54)

Hard-kills an owned process tree. The operation must reject promptly when
`signal` is aborted; dispose must settle any backend work started by it.

#### Parameters

##### signal

`AbortSignal`

#### Returns

`Promise`\<`void`\>

***

### killOwnedTreeAtExitBoundary()?

> `optional` **killOwnedTreeAtExitBoundary**(): `void`

Defined in: [pty.ts:47](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L47)

Synchronously closes the owned POSIX group at the root-exit boundary.

#### Returns

`void`

***

### onData()

> **onData**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:55](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L55)

#### Parameters

##### cb

(`data`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onExit()

> **onExit**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:56](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L56)

#### Parameters

##### cb

(`status`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteDrain()?

> `optional` **onWriteDrain**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L69)

Queue-drained notification; it does not claim child consumption.

#### Parameters

##### cb

() => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteError()?

> `optional` **onWriteError**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:67](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L67)

Fatal asynchronous failures after `write()` accepted bytes.

#### Parameters

##### cb

(`error`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### resize()

> **resize**(`columns`, `rows`): `void`

Defined in: [pty.ts:43](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L43)

#### Parameters

##### columns

`number`

##### rows

`number`

#### Returns

`void`

***

### signal()

> **signal**(`sig`): `void`

Defined in: [pty.ts:45](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L45)

Delivers a POSIX signal. On Windows only `KILL` is supported.

#### Parameters

##### sig

[`PtySignal`](../../type-aliases/ptysignal/)

#### Returns

`void`

***

### terminate()?

> `optional` **terminate**(): `void`

Defined in: [pty.ts:49](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L49)

Backend-native graceful lifecycle request; required when tree ownership is delegated.

#### Returns

`void`

***

### treeState()?

> `optional` **treeState**(): `"alive"` \| `"gone"` \| `"unsupported"`

Defined in: [pty.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L71)

Liveness of the owned tree, when the backend has an OS primitive for it.

#### Returns

`"alive"` \| `"gone"` \| `"unsupported"`

***

### write()

> **write**(`data`): `void`

Defined in: [pty.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L32)

Queues raw bytes in the backend's ordered input stream. Never appends a
newline. A successful return proves queue admission, not child
consumption; semantic actions prove consumption through their committed
postcondition.

#### Parameters

##### data

`Uint8Array`

#### Returns

`void`

***

### writeTerminalResponse()?

> `optional` **writeTerminalResponse**(`data`): `void`

Defined in: [pty.ts:42](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L42)

Queues bytes generated by the terminal emulator in response to an
application query. ConPTY backends use this distinct path because their
host keeps Win32 Input Mode enabled and therefore expects synthesized
KEY_EVENT records rather than raw VT bytes.

Backends without a separate terminal-response transport may omit this
method; the driver then uses [write](#write).

#### Parameters

##### data

`Uint8Array`

#### Returns

`void`
