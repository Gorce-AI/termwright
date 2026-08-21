---
title: "Class: ProcessExitedError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ProcessExitedError

# Class: ProcessExitedError

Defined in: [errors.ts:103](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L103)

The child process exited before the awaited condition could be satisfied.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new ProcessExitedError**(`message`, `diagnostics`): `ProcessExitedError`

Defined in: [errors.ts:104](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L104)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`ProcessExitedError`

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
