---
title: "Class: NotFoundError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / NotFoundError

# Class: NotFoundError

Defined in: [errors.ts:120](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L120)

A named resource does not exist. Reserved for absence, never for a resource
that is present and wrong — that is a `protocol-violation`.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new NotFoundError**(`message`, `diagnostics`): `NotFoundError`

Defined in: [errors.ts:121](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L121)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`NotFoundError`

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
