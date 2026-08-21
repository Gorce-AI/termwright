---
title: "Class: CapacityError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CapacityError

# Class: CapacityError

Defined in: [errors.ts:96](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L96)

A bounded resource (queued frames, pending waiters, sessions) is exhausted.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new CapacityError**(`message`, `diagnostics`): `CapacityError`

Defined in: [errors.ts:97](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L97)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`CapacityError`

#### Overrides

[`TermwrightError`](../termwrighterror/).[`constructor`](../termwrighterror/#constructor)

## Properties

### code

> `readonly` **code**: [`TermwrightErrorCode`](../../type-aliases/termwrighterrorcode/)

Defined in: [errors.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L19)

#### Inherited from

[`TermwrightError`](../termwrighterror/).[`code`](../termwrighterror/#code)

***

### diagnostics

> `readonly` **diagnostics**: [`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

Defined in: [errors.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L20)

#### Inherited from

[`TermwrightError`](../termwrighterror/).[`diagnostics`](../termwrighterror/#diagnostics)

## Methods

### toString()

> **toString**(): `string`

Defined in: [errors.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L30)

Renders message + diagnostics the way test runners print failures.

#### Returns

`string`

#### Inherited from

[`TermwrightError`](../termwrighterror/).[`toString`](../termwrighterror/#tostring)
