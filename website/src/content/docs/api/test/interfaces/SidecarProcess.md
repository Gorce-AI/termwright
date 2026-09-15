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

> `readonly` **exit**: `Promise`\<[`SidecarExit`](../sidecarexit/)\>

Defined in: [test/src/sidecar.ts:35](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L35)

Authoritative process termination. `reason` is portable; `code` and
`signal` preserve the platform's raw child-process result.

***

### pid

> `readonly` **pid**: `number`

Defined in: [test/src/sidecar.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L30)

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [test/src/sidecar.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L38)

#### Returns

`Promise`\<`void`\>

***

### stderr()

> **stderr**(): `string`

Defined in: [test/src/sidecar.ts:37](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L37)

#### Returns

`string`

***

### stdout()

> **stdout**(): `string`

Defined in: [test/src/sidecar.ts:36](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L36)

#### Returns

`string`
