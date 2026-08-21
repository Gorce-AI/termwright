---
title: "Class: ProtocolViolationError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ProtocolViolationError

# Class: ProtocolViolationError

Defined in: [errors.ts:89](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L89)

The adapter violated the semantic protocol; its channel was closed.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new ProtocolViolationError**(`message`, `diagnostics`): `ProtocolViolationError`

Defined in: [errors.ts:90](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L90)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`ProtocolViolationError`

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
