---
title: "Interface: PtyProcess"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / PtyProcess

# Interface: PtyProcess

Defined in: [driver/src/pty.ts:25](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L25)

A live pseudo-terminal hosting one child process.

## Properties

### pid

> `readonly` **pid**: `number`

Defined in: [driver/src/pty.ts:26](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L26)

## Methods

### dispose()

> **dispose**(): `void`

Defined in: [driver/src/pty.ts:35](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L35)

Idempotent; releases the pty without signalling the child.

#### Returns

`void`

***

### onData()

> **onData**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [driver/src/pty.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L32)

#### Parameters

##### cb

(`data`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onExit()

> **onExit**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [driver/src/pty.ts:33](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L33)

#### Parameters

##### cb

(`status`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### resize()

> **resize**(`columns`, `rows`): `void`

Defined in: [driver/src/pty.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L29)

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

Defined in: [driver/src/pty.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L31)

Delivers a POSIX signal. On Windows only `KILL` is honored (TerminateProcess).

#### Parameters

##### sig

[`PtySignal`](../../type-aliases/ptysignal/)

#### Returns

`void`

***

### write()

> **write**(`data`): `void`

Defined in: [driver/src/pty.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L28)

Writes raw bytes to the child's stdin. Never appends a newline.

#### Parameters

##### data

`Uint8Array`

#### Returns

`void`
