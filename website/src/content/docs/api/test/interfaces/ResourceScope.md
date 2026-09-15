---
title: "Interface: ResourceScope"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / ResourceScope

# Interface: ResourceScope

Defined in: [test/src/resource-scope.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L29)

Test-owned resources with deterministic LIFO teardown.

An acquisition reserves its cleanup position before its asynchronous factory
starts. This closes the usual timeout race: a resource that appears after the
test has begun tearing down is still disposed before `close()` resolves.

## Properties

### closed

> `readonly` **closed**: `boolean`

Defined in: [test/src/resource-scope.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L31)

***

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [test/src/resource-scope.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L30)

## Methods

### acquire()

> **acquire**\<`T`\>(`factory`): `Promise`\<`T`\>

Defined in: [test/src/resource-scope.ts:34](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L34)

#### Type Parameters

##### T

`T` *extends* [`DisposableResource`](../disposableresource/)

#### Parameters

##### factory

(`signal`) => `T` \| `Promise`\<`T`\>

#### Returns

`Promise`\<`T`\>

***

### child()

> **child**(): `ResourceScope`

Defined in: [test/src/resource-scope.ts:37](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L37)

#### Returns

`ResourceScope`

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [test/src/resource-scope.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L38)

#### Returns

`Promise`\<`void`\>

***

### defer()

> **defer**(`cleanup`): `void`

Defined in: [test/src/resource-scope.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L32)

#### Parameters

##### cleanup

() => `unknown`

#### Returns

`void`

***

### use()

> **use**\<`T`\>(`resource`): `T`

Defined in: [test/src/resource-scope.ts:33](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L33)

#### Type Parameters

##### T

`T` *extends* [`DisposableResource`](../disposableresource/)

#### Parameters

##### resource

`T`

#### Returns

`T`
