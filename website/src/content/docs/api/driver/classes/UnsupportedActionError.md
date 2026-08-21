---
title: "Class: UnsupportedActionError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / UnsupportedActionError

# Class: UnsupportedActionError

Defined in: [errors.ts:75](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L75)

The requested physical action is impossible in the current session, e.g. a
click while the child never enabled mouse tracking, or a semantic query
without a semantic tree.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new UnsupportedActionError**(`message`, `diagnostics`): `UnsupportedActionError`

Defined in: [errors.ts:76](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L76)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`UnsupportedActionError`

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
