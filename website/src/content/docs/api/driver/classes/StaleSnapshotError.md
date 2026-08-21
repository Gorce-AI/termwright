---
title: "Class: StaleSnapshotError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / StaleSnapshotError

# Class: StaleSnapshotError

Defined in: [errors.ts:57](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L57)

A ref (`n8@42`) was used after its revision was superseded or evicted.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new StaleSnapshotError**(`message`, `diagnostics`): `StaleSnapshotError`

Defined in: [errors.ts:58](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L58)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`StaleSnapshotError`

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
