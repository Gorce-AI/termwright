---
title: "Interface: SidecarProcess"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / SidecarProcess

# Interface: SidecarProcess

Defined in: [test/src/sidecar.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L29)

## Properties

### exit

> `readonly` **exit**: `Promise`\<\{ `code`: `number` \| `null`; `signal`: `Signals` \| `null`; \}\>

Defined in: [test/src/sidecar.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L31)

***

### pid

> `readonly` **pid**: `number`

Defined in: [test/src/sidecar.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L30)

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [test/src/sidecar.ts:34](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L34)

#### Returns

`Promise`\<`void`\>

***

### stderr()

> **stderr**(): `string`

Defined in: [test/src/sidecar.ts:33](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L33)

#### Returns

`string`

***

### stdout()

> **stdout**(): `string`

Defined in: [test/src/sidecar.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L32)

#### Returns

`string`
