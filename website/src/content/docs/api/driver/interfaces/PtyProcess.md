---
title: "Interface: PtyProcess"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / PtyProcess

# Interface: PtyProcess

Defined in: [driver/src/pty.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L28)

A live pseudo-terminal hosting one child process.

## Properties

### lifecycle?

> `readonly` `optional` **lifecycle?**: `object`

Defined in: [driver/src/pty.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L31)

Truthful lifecycle properties when the backend can prove them.

#### outputDrain

> `readonly` **outputDrain**: `"eof"` \| `"bounded-fallback"`

#### tree

> `readonly` **tree**: `"posix-process-group"` \| `"conpty-console"` \| `"delegated"`

***

### pid

> `readonly` **pid**: `number`

Defined in: [driver/src/pty.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L29)

## Methods

### dispose()

> **dispose**(): `void`

Defined in: [driver/src/pty.ts:62](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L62)

Idempotent finalizer; hangs up a still-live PTY before releasing listeners.

#### Returns

`void`

***

### hardKillTree()?

> `optional` **hardKillTree**(): `Promise`\<`void`\>

Defined in: [driver/src/pty.ts:52](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L52)

Hard-kills an owned process tree and captures the exact members that must
subsequently be proven gone. Backends that claim tree ownership should
expose this when the preparation step is asynchronous.

#### Returns

`Promise`\<`void`\>

***

### onData()

> **onData**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [driver/src/pty.ts:53](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L53)

#### Parameters

##### cb

(`data`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onExit()

> **onExit**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [driver/src/pty.ts:54](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L54)

#### Parameters

##### cb

(`status`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteDrain()?

> `optional` **onWriteDrain**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [driver/src/pty.ts:58](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L58)

Queue-drained notification; it still does not claim child consumption.

#### Parameters

##### cb

() => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteError()?

> `optional` **onWriteError**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [driver/src/pty.ts:56](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L56)

Fatal asynchronous failures after write() accepted bytes.

#### Parameters

##### cb

(`error`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### resize()

> **resize**(`columns`, `rows`): `void`

Defined in: [driver/src/pty.ts:42](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L42)

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

Defined in: [driver/src/pty.ts:44](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L44)

Delivers a POSIX signal. On Windows only `KILL` is honored (TerminateProcess).

#### Parameters

##### sig

[`PtySignal`](../../type-aliases/ptysignal/)

#### Returns

`void`

***

### terminate()?

> `optional` **terminate**(): `void`

Defined in: [driver/src/pty.ts:46](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L46)

Backend-native graceful lifecycle request; required when tree is delegated.

#### Returns

`void`

***

### treeState()?

> `optional` **treeState**(): `"unsupported"` \| `"alive"` \| `"gone"`

Defined in: [driver/src/pty.ts:60](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L60)

Liveness of the owned tree, when the backend has an OS primitive for it.

#### Returns

`"unsupported"` \| `"alive"` \| `"gone"`

***

### write()

> **write**(`data`): `void`

Defined in: [driver/src/pty.ts:41](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L41)

Queues raw bytes in the backend's ordered input stream. Never appends a
newline. A successful return proves queue admission, not child
consumption; semantic actions prove consumption through their committed
postcondition.

#### Parameters

##### data

`Uint8Array`

#### Returns

`void`
