---
title: "Interface: NativePtySessionHandle"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / NativePtySessionHandle

# Interface: NativePtySessionHandle

Defined in: [native-pty-backend.ts:14](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L14)

## Properties

### outputEnded

> `readonly` **outputEnded**: `Promise`\<`void`\>

Defined in: [native-pty-backend.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L16)

***

### pid

> `readonly` **pid**: `number`

Defined in: [native-pty-backend.ts:15](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L15)

***

### sawRealEof

> `readonly` **sawRealEof**: `boolean`

Defined in: [native-pty-backend.ts:17](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L17)

## Methods

### dispose()

> **dispose**(): `void`

Defined in: [native-pty-backend.ts:26](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L26)

#### Returns

`void`

***

### onData()

> **onData**(`listener`): () => `void`

Defined in: [native-pty-backend.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L22)

#### Parameters

##### listener

(`data`) => `void`

#### Returns

() => `void`

***

### onDrain()

> **onDrain**(`listener`): () => `void`

Defined in: [native-pty-backend.ts:25](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L25)

#### Parameters

##### listener

() => `void`

#### Returns

() => `void`

***

### onError()

> **onError**(`listener`): () => `void`

Defined in: [native-pty-backend.ts:24](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L24)

#### Parameters

##### listener

(`error`) => `void`

#### Returns

() => `void`

***

### onExit()

> **onExit**(`listener`): () => `void`

Defined in: [native-pty-backend.ts:23](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L23)

#### Parameters

##### listener

(`status`) => `void`

#### Returns

() => `void`

***

### resize()

> **resize**(`columns`, `rows`): `boolean`

Defined in: [native-pty-backend.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L19)

#### Parameters

##### columns

`number`

##### rows

`number`

#### Returns

`boolean`

***

### signal()

> **signal**(`signal`): `boolean`

Defined in: [native-pty-backend.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L20)

#### Parameters

##### signal

[`PtySignal`](../../type-aliases/ptysignal/)

#### Returns

`boolean`

***

### treeState()

> **treeState**(): `"alive"` \| `"gone"` \| `"unsupported"`

Defined in: [native-pty-backend.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L21)

#### Returns

`"alive"` \| `"gone"` \| `"unsupported"`

***

### write()

> **write**(`data`): `void`

Defined in: [native-pty-backend.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/native-pty-backend.ts#L18)

#### Parameters

##### data

`Uint8Array`

#### Returns

`void`
