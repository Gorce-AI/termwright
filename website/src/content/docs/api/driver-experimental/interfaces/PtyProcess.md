---
title: "Interface: PtyProcess"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyProcess

# Interface: PtyProcess

Defined in: [pty.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L29)

A live pseudo-terminal hosting one child process.

## Properties

### lifecycle?

> `readonly` `optional` **lifecycle?**: `object`

Defined in: [pty.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L32)

Truthful lifecycle properties when the backend can prove them.

#### outputDrain

> `readonly` **outputDrain**: `"eof"` \| `"bounded-fallback"`

#### tree

> `readonly` **tree**: `"posix-process-group"` \| `"conpty-console"` \| `"delegated"`

***

### outputEnded?

> `readonly` `optional` **outputEnded?**: `Promise`\<`void`\>

Defined in: [pty.ts:61](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L61)

Settles once the backend's output producer can deliver no more bytes.

***

### pid

> `readonly` **pid**: `number`

Defined in: [pty.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L30)

***

### sawOutputEnd?

> `readonly` `optional` **sawOutputEnd?**: () => `boolean`

Defined in: [pty.ts:73](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L73)

Whether the producer stopped because its source ended, as opposed to being
torn down with bytes still unread.

`outputEnded` settles either way — a waiter must not outlive the thing it
waits for — so on its own it cannot say whether the stream is complete.
The two are different facts and a session that publishes an exit needs the
second one: a destroyed source has lost whatever had not been read yet,
and reporting that as a clean finish hands the caller a screen that is
missing its last line with nothing to indicate it.

#### Returns

`boolean`

## Methods

### attach()?

> `optional` **attach**(`signal`): `Promise`\<`void`\>

Defined in: [pty.ts:83](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L83)

Settles once the backend has finished attaching, if it attaches at all.

ConPTY creates the child from a callback that fires when its output worker
is ready, so a freshly spawned pty has no pid and an empty console process
list until then — the same two values a reaped tree produces. A session
that waits for this before running cannot reach teardown in that state.
The operation must reject and settle promptly when `signal` is aborted.

#### Parameters

##### signal

`AbortSignal`

#### Returns

`Promise`\<`void`\>

***

### dispose()

> **dispose**(): `void`

Defined in: [pty.ts:91](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L91)

Idempotent finalizer; hangs up a still-live PTY before releasing listeners.

#### Returns

`void`

***

### hardKillTree()?

> `optional` **hardKillTree**(`signal`): `Promise`\<`void`\>

Defined in: [pty.ts:57](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L57)

Hard-kills an owned process tree and captures the exact members that must
subsequently be proven gone. Backends that claim tree ownership should
expose this when the preparation step is asynchronous. The operation must
reject and settle promptly when `signal` is aborted; dispose must settle
any backend work started by it.

#### Parameters

##### signal

`AbortSignal`

#### Returns

`Promise`\<`void`\>

***

### killOwnedTreeAtExitBoundary()?

> `optional` **killOwnedTreeAtExitBoundary**(): `void`

Defined in: [pty.ts:47](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L47)

Synchronously kills the owned POSIX group at the root-exit callback boundary.

#### Returns

`void`

***

### onData()

> **onData**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:58](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L58)

#### Parameters

##### cb

(`data`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onExit()

> **onExit**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:59](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L59)

#### Parameters

##### cb

(`status`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteDrain()?

> `optional` **onWriteDrain**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:87](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L87)

Queue-drained notification; it still does not claim child consumption.

#### Parameters

##### cb

() => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteError()?

> `optional` **onWriteError**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:85](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L85)

Fatal asynchronous failures after write() accepted bytes.

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

Delivers a POSIX signal. On Windows only `KILL` is honored (TerminateProcess).

#### Parameters

##### sig

[`PtySignal`](../../type-aliases/ptysignal/)

#### Returns

`void`

***

### terminate()?

> `optional` **terminate**(): `void`

Defined in: [pty.ts:49](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L49)

Backend-native graceful lifecycle request; required when tree is delegated.

#### Returns

`void`

***

### treeState()?

> `optional` **treeState**(): `"alive"` \| `"gone"` \| `"unsupported"`

Defined in: [pty.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L89)

Liveness of the owned tree, when the backend has an OS primitive for it.

#### Returns

`"alive"` \| `"gone"` \| `"unsupported"`

***

### write()

> **write**(`data`): `void`

Defined in: [pty.ts:42](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L42)

Queues raw bytes in the backend's ordered input stream. Never appends a
newline. A successful return proves queue admission, not child
consumption; semantic actions prove consumption through their committed
postcondition.

#### Parameters

##### data

`Uint8Array`

#### Returns

`void`
