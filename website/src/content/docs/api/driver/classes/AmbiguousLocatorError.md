---
title: "Class: AmbiguousLocatorError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / AmbiguousLocatorError

# Class: AmbiguousLocatorError

Defined in: [errors.ts:64](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L64)

Strict-mode violation: a locator matched more than one node.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new AmbiguousLocatorError**(`message`, `candidates`, `diagnostics`): `AmbiguousLocatorError`

Defined in: [errors.ts:65](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L65)

#### Parameters

##### message

`string`

##### candidates

readonly [`ResolvedTarget`](../../interfaces/resolvedtarget/)[]

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`AmbiguousLocatorError`

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
