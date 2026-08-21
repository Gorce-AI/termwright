---
title: "Class: SessionClosedError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionClosedError

# Class: SessionClosedError

Defined in: [errors.ts:110](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L110)

The harness was closed; no further observation or input is possible.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new SessionClosedError**(`message`, `diagnostics`): `SessionClosedError`

Defined in: [errors.ts:111](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L111)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`SessionClosedError`

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
