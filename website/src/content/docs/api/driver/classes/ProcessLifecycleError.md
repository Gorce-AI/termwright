---
title: "Class: ProcessLifecycleError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ProcessLifecycleError

# Class: ProcessLifecycleError

Defined in: driver/src/internal/process-supervisor.ts:7

## Extends

- `Error`

## Constructors

### Constructor

> **new ProcessLifecycleError**(`code`, `message`, `options?`): `ProcessLifecycleError`

Defined in: driver/src/internal/process-supervisor.ts:11

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

Defined in: driver/src/internal/process-supervisor.ts:8

***

### exitObserved

> `readonly` **exitObserved**: `boolean`

Defined in: driver/src/internal/process-supervisor.ts:9
