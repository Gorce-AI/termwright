---
title: "Interface: ConPtySessionHandle"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / ConPtySessionHandle

# Interface: ConPtySessionHandle

Defined in: [conpty-backend.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L28)

The part of `@termwright/conpty` this adapter needs.

## Properties

### outputEnded

> `readonly` **outputEnded**: `Promise`\<`void`\>

Defined in: [conpty-backend.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L30)

***

### pid

> `readonly` **pid**: `number`

Defined in: [conpty-backend.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L29)

***

### sawRealEof

> `readonly` **sawRealEof**: `boolean`

Defined in: [conpty-backend.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L32)

True only when the output pipe actually ended; disposal does not set it.

## Methods

### activeProcesses()

> **activeProcesses**(): `number`

Defined in: [conpty-backend.ts:36](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L36)

#### Returns

`number`

***

### dispose()

> **dispose**(): `void`

Defined in: [conpty-backend.ts:42](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L42)

#### Returns

`void`

***

### onData()

> **onData**(`listener`): () => `void`

Defined in: [conpty-backend.ts:37](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L37)

#### Parameters

##### listener

(`data`) => `void`

#### Returns

() => `void`

***

### onError()

> **onError**(`listener`): () => `void`

Defined in: [conpty-backend.ts:41](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L41)

#### Parameters

##### listener

(`error`) => `void`

#### Returns

() => `void`

***

### onExit()

> **onExit**(`listener`): () => `void`

Defined in: [conpty-backend.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L38)

#### Parameters

##### listener

(`status`) => `void`

#### Returns

() => `void`

***

### resize()

> **resize**(`columns`, `rows`): `boolean`

Defined in: [conpty-backend.ts:34](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L34)

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

Defined in: [conpty-backend.ts:35](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L35)

#### Returns

`void`

***

### write()

> **write**(`data`): `void`

Defined in: [conpty-backend.ts:33](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/conpty-backend.ts#L33)

#### Parameters

##### data

`Uint8Array`

#### Returns

`void`
