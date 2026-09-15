---
title: "Interface: DisposableResource"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / DisposableResource

# Interface: DisposableResource

Defined in: [test/src/resource-scope.ts:2](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L2)

A resource that can be owned by a test or scenario scope.

## Properties

### \[asyncDispose\]?

> `optional` **\[asyncDispose\]?**: () => `unknown`

Defined in: [test/src/resource-scope.ts:6](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L6)

#### Returns

`unknown`

***

### \[dispose\]?

> `optional` **\[dispose\]?**: () => `unknown`

Defined in: [test/src/resource-scope.ts:5](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L5)

#### Returns

`unknown`

***

### close?

> `optional` **close?**: () => `unknown`

Defined in: [test/src/resource-scope.ts:3](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L3)

#### Returns

`unknown`

***

### dispose?

> `optional` **dispose?**: () => `unknown`

Defined in: [test/src/resource-scope.ts:4](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/resource-scope.ts#L4)

#### Returns

`unknown`
