---
title: "Class: HistoryTruncatedError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / HistoryTruncatedError

# Class: HistoryTruncatedError

Defined in: [errors.ts:82](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L82)

Scrollback data was requested below the retained floor.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new HistoryTruncatedError**(`message`, `diagnostics`): `HistoryTruncatedError`

Defined in: [errors.ts:83](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L83)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`HistoryTruncatedError`

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
