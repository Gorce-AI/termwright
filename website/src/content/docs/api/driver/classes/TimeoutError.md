---
title: "Class: TimeoutError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TimeoutError

# Class: TimeoutError

Defined in: [errors.ts:50](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L50)

A bounded wait (locator resolution, text/render/idle/exit wait) ran out.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new TimeoutError**(`message`, `diagnostics`): `TimeoutError`

Defined in: [errors.ts:51](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L51)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`TimeoutError`

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
