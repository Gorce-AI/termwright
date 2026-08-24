---
title: "Interface: ConPtySessionHandle"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ConPtySessionHandle

# Interface: ConPtySessionHandle

Defined in: [driver/src/conpty-backend.ts:27](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L27)

The part of `@termwright/conpty` this adapter needs.

## Properties

### outputEnded

> `readonly` **outputEnded**: `Promise`\<`void`\>

Defined in: [driver/src/conpty-backend.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L29)

***

### pid

> `readonly` **pid**: `number`

Defined in: [driver/src/conpty-backend.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L28)

***

### sawRealEof

> `readonly` **sawRealEof**: `boolean`

Defined in: [driver/src/conpty-backend.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L31)

True only when the output pipe actually ended; disposal does not set it.

## Methods

### activeProcesses()

> **activeProcesses**(): `number`

Defined in: [driver/src/conpty-backend.ts:35](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L35)

#### Returns

`number`

***

### dispose()

> **dispose**(): `void`

Defined in: [driver/src/conpty-backend.ts:39](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L39)

#### Returns

`void`

***

### onData()

> **onData**(`listener`): () => `void`

Defined in: [driver/src/conpty-backend.ts:36](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L36)

#### Parameters

##### listener

(`data`) => `void`

#### Returns

() => `void`

***

### onError()

> **onError**(`listener`): () => `void`

Defined in: [driver/src/conpty-backend.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L38)

#### Parameters

##### listener

(`error`) => `void`

#### Returns

() => `void`

***

### onExit()

> **onExit**(`listener`): () => `void`

Defined in: [driver/src/conpty-backend.ts:37](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L37)

#### Parameters

##### listener

(`status`) => `void`

#### Returns

() => `void`

***

### resize()

> **resize**(`columns`, `rows`): `boolean`

Defined in: [driver/src/conpty-backend.ts:33](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L33)

#### Parameters

##### columns

`number`

##### rows

`number`

#### Returns

`boolean`

***

### terminateTree()

> **terminateTree**(): `void`

Defined in: [driver/src/conpty-backend.ts:34](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L34)

#### Returns

`void`

***

### write()

> **write**(`data`): `void`

Defined in: [driver/src/conpty-backend.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L32)

#### Parameters

##### data

`Uint8Array`

#### Returns

`void`
