---
title: "Interface: PtyProcess"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyProcess

# Interface: PtyProcess

Defined in: [pty.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L28)

A live pseudo-terminal hosting one child process.

## Properties

### attached?

> `readonly` `optional` **attached?**: `Promise`\<`void`\>

Defined in: [pty.ts:77](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L77)

Settles once the backend has finished attaching, if it attaches at all.

ConPTY creates the child from a callback that fires when its output worker
is ready, so a freshly spawned pty has no pid and an empty console process
list until then — the same two values a reaped tree produces. A session
that waits for this before running cannot reach teardown in that state.

***

### lifecycle?

> `readonly` `optional` **lifecycle?**: `object`

Defined in: [pty.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L31)

Truthful lifecycle properties when the backend can prove them.

#### outputDrain

> `readonly` **outputDrain**: `"eof"` \| `"bounded-fallback"`

#### tree

> `readonly` **tree**: `"posix-process-group"` \| `"conpty-console"` \| `"delegated"`

***

### outputEnded?

> `readonly` `optional` **outputEnded?**: `Promise`\<`void`\>

Defined in: [pty.ts:56](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L56)

Settles once the backend's output producer can deliver no more bytes.

***

### pid

> `readonly` **pid**: `number`

Defined in: [pty.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L29)

***

### sawOutputEnd?

> `readonly` `optional` **sawOutputEnd?**: () => `boolean`

Defined in: [pty.ts:68](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L68)

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

### dispose()

> **dispose**(): `void`

Defined in: [pty.ts:85](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L85)

Idempotent finalizer; hangs up a still-live PTY before releasing listeners.

#### Returns

`void`

***

### hardKillTree()?

> `optional` **hardKillTree**(): `Promise`\<`void`\>

Defined in: [pty.ts:52](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L52)

Hard-kills an owned process tree and captures the exact members that must
subsequently be proven gone. Backends that claim tree ownership should
expose this when the preparation step is asynchronous.

#### Returns

`Promise`\<`void`\>

***

### onData()

> **onData**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:53](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L53)

#### Parameters

##### cb

(`data`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onExit()

> **onExit**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:54](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L54)

#### Parameters

##### cb

(`status`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteDrain()?

> `optional` **onWriteDrain**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:81](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L81)

Queue-drained notification; it still does not claim child consumption.

#### Parameters

##### cb

() => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteError()?

> `optional` **onWriteError**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:79](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L79)

Fatal asynchronous failures after write() accepted bytes.

#### Parameters

##### cb

(`error`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### resize()

> **resize**(`columns`, `rows`): `void`

Defined in: [pty.ts:42](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L42)

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

Defined in: [pty.ts:44](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L44)

Delivers a POSIX signal. On Windows only `KILL` is honored (TerminateProcess).

#### Parameters

##### sig

[`PtySignal`](../../type-aliases/ptysignal/)

#### Returns

`void`

***

### terminate()?

> `optional` **terminate**(): `void`

Defined in: [pty.ts:46](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L46)

Backend-native graceful lifecycle request; required when tree is delegated.

#### Returns

`void`

***

### treeState()?

> `optional` **treeState**(): `"alive"` \| `"gone"` \| `"unsupported"`

Defined in: [pty.ts:83](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L83)

Liveness of the owned tree, when the backend has an OS primitive for it.

#### Returns

`"alive"` \| `"gone"` \| `"unsupported"`

***

### write()

> **write**(`data`): `void`

Defined in: [pty.ts:41](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L41)

Queues raw bytes in the backend's ordered input stream. Never appends a
newline. A successful return proves queue admission, not child
consumption; semantic actions prove consumption through their committed
postcondition.

#### Parameters

##### data

`Uint8Array`

#### Returns

`void`
