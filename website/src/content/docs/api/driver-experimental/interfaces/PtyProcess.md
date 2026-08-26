---
title: "Interface: PtyProcess"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / PtyProcess

# Interface: PtyProcess

Defined in: [pty.ts:15](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L15)

## Properties

### lifecycle?

> `readonly` `optional` **lifecycle?**: `object`

Defined in: [pty.ts:17](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L17)

#### outputDrain

> `readonly` **outputDrain**: `"eof"` \| `"bounded-fallback"`

#### tree

> `readonly` **tree**: `"posix-process-group"` \| `"conpty-console"` \| `"delegated"`

***

### outputEnded?

> `readonly` `optional` **outputEnded?**: `Promise`\<`void`\>

Defined in: [pty.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L29)

***

### pid

> `readonly` **pid**: `number`

Defined in: [pty.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L16)

***

### sawOutputEnd?

> `readonly` `optional` **sawOutputEnd?**: () => `boolean`

Defined in: [pty.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L30)

#### Returns

`boolean`

## Methods

### attach()?

> `optional` **attach**(`signal`): `Promise`\<`void`\>

Defined in: [pty.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L31)

#### Parameters

##### signal

`AbortSignal`

#### Returns

`Promise`\<`void`\>

***

### dispose()

> **dispose**(): `void`

Defined in: [pty.ts:35](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L35)

#### Returns

`void`

***

### hardKillTree()?

> `optional` **hardKillTree**(`signal`): `Promise`\<`void`\>

Defined in: [pty.ts:26](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L26)

#### Parameters

##### signal

`AbortSignal`

#### Returns

`Promise`\<`void`\>

***

### killOwnedTreeAtExitBoundary()?

> `optional` **killOwnedTreeAtExitBoundary**(): `void`

Defined in: [pty.ts:24](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L24)

#### Returns

`void`

***

### onData()

> **onData**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:27](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L27)

#### Parameters

##### cb

(`data`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onExit()

> **onExit**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L28)

#### Parameters

##### cb

(`status`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteDrain()?

> `optional` **onWriteDrain**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:33](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L33)

#### Parameters

##### cb

() => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### onWriteError()?

> `optional` **onWriteError**(`cb`): [`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

Defined in: [pty.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L32)

#### Parameters

##### cb

(`error`) => `void`

#### Returns

[`PtyUnsubscribe`](../../type-aliases/ptyunsubscribe/)

***

### resize()

> **resize**(`columns`, `rows`): `void`

Defined in: [pty.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L22)

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

Defined in: [pty.ts:23](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L23)

#### Parameters

##### sig

[`PtySignal`](../../type-aliases/ptysignal/)

#### Returns

`void`

***

### terminate()?

> `optional` **terminate**(): `void`

Defined in: [pty.ts:25](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L25)

#### Returns

`void`

***

### treeState()?

> `optional` **treeState**(): `"alive"` \| `"gone"` \| `"unsupported"`

Defined in: [pty.ts:34](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L34)

#### Returns

`"alive"` \| `"gone"` \| `"unsupported"`

***

### write()

> **write**(`data`): `void`

Defined in: [pty.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/pty.ts#L21)

#### Parameters

##### data

`Uint8Array`

#### Returns

`void`
