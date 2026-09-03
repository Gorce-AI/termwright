---
title: "Interface: PtyProcess"
editUrl: false
pagefind: false
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

Defined in: [pty.ts:64](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L64)

Settles once the backend's output producer can deliver no more bytes.

***

### pid

> `readonly` **pid**: `number`

Defined in: [pty.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L20)

***

### sawOutputEnd?

> `readonly` `optional` **sawOutputEnd?**: () => `boolean`

Defined in: [pty.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L69)

Whether the producer reached its authoritative EOF rather than being torn
down with bytes potentially unread. `outputEnded` settles in both cases.

#### Returns

`boolean`

## Methods

### attach()?

> `optional` **attach**(`signal`): `Promise`\<`void`\>

Defined in: [pty.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L71)

Settles once an asynchronously created native session is ready for lifecycle operations.

#### Parameters

##### signal

`AbortSignal`

#### Returns

`Promise`\<`void`\>

***

### closeInput()?

> `optional` **closeInput**(): `void`

Defined in: [pty.ts:48](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L48)

Closes owned terminal input without disposing the output producer.

#### Returns

`void`

***

### dispose()

> **dispose**(): `void`

Defined in: [pty.ts:81](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L81)

Idempotent finalizer; hangs up a live PTY before releasing listeners.

#### Returns

`void`

***

### hardKillTree()?

> `optional` **hardKillTree**(`signal`): `Promise`\<`void`\>

Defined in: [pty.ts:60](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L60)

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

Defined in: [pty.ts:53](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L53)

Synchronously closes the owned POSIX group at the root-exit boundary.

#### Returns

`void`

***

### onData()

> **onData**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:61](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L61)

#### Parameters

##### cb

(`data`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onExit()

> **onExit**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:62](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L62)

#### Parameters

##### cb

(`status`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteDrain()?

> `optional` **onWriteDrain**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:75](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L75)

Queue-drained notification; it does not claim child consumption.

#### Parameters

##### cb

() => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteError()?

> `optional` **onWriteError**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:73](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L73)

Fatal asynchronous failures after `write()` accepted bytes.

#### Parameters

##### cb

(`error`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### ownedProcessResources()?

> `optional` **ownedProcessResources**(): `OwnedProcessResourceUsage` \| `null`

Defined in: [pty.ts:79](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L79)

Native whole-tree accounting, when the ownership primitive supports it.

#### Returns

`OwnedProcessResourceUsage` \| `null`

***

### resize()

> **resize**(`columns`, `rows`): `void`

Defined in: [pty.ts:49](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L49)

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

Defined in: [pty.ts:51](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L51)

Delivers a POSIX signal. On Windows only `KILL` is supported.

#### Parameters

##### sig

[`PtySignal`](../../type-aliases/ptysignal/)

#### Returns

`void`

***

### terminate()?

> `optional` **terminate**(): `void`

Defined in: [pty.ts:55](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L55)

Backend-native graceful lifecycle request; required when tree ownership is delegated.

#### Returns

`void`

***

### treeState()?

> `optional` **treeState**(): `"alive"` \| `"gone"` \| `"unsupported"`

Defined in: [pty.ts:77](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L77)

Liveness of the owned tree, when the backend has an OS primitive for it.

#### Returns

`"alive"` \| `"gone"` \| `"unsupported"`

***

### write()

> **write**(`data`, `kind?`): `void`

Defined in: [pty.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L32)

Queues raw bytes in the backend's ordered input stream. Never appends a
newline. A successful return proves queue admission, not child
consumption; semantic actions prove consumption through their committed
postcondition.

#### Parameters

##### data

`Uint8Array`

##### kind?

`"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

#### Returns

`void`

***

### writeTerminalResponse()?

> `optional` **writeTerminalResponse**(`data`): `"host-control"` \| `"application-envelope"` \| `"application-direct"`

Defined in: [pty.ts:44](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L44)

Queues bytes generated by the terminal emulator in response to a terminal
query. ConPTY backends use this distinct path so the pinned host's private,
request-addressed cursor RPC remains distinguishable from ordinary
application replies. The Windows application route wraps each complete
response in the pinned host's private atomic envelope; other backends may
write the response directly.

Backends without a separate terminal-response transport may omit this
method; the driver then uses [write](#write).

#### Parameters

##### data

`Uint8Array`

#### Returns

`"host-control"` \| `"application-envelope"` \| `"application-direct"`
