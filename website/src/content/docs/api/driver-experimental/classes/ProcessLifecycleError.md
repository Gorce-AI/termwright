---
title: "Class: ProcessLifecycleError"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / ProcessLifecycleError

# Class: ProcessLifecycleError

Defined in: [internal/process-supervisor.ts:6](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/internal/process-supervisor.ts#L6)

## Extends

- `Error`

## Constructors

### Constructor

> **new ProcessLifecycleError**(`code`, `message`, `options?`): `ProcessLifecycleError`

Defined in: [internal/process-supervisor.ts:10](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/internal/process-supervisor.ts#L10)

#### Parameters

##### code

[`ProcessLifecycleErrorCode`](../../type-aliases/processlifecycleerrorcode/)

##### message

`string`

##### options?

`ErrorOptions` & `object`

#### Returns

`ProcessLifecycleError`

#### Overrides

`Error.constructor`

## Properties

### code

> `readonly` **code**: [`ProcessLifecycleErrorCode`](../../type-aliases/processlifecycleerrorcode/)

Defined in: [internal/process-supervisor.ts:7](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/internal/process-supervisor.ts#L7)

***

### exitObserved

> `readonly` **exitObserved**: `boolean`

Defined in: [internal/process-supervisor.ts:8](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/internal/process-supervisor.ts#L8)
