---
title: "Class: DuplicateSemanticKeyError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / DuplicateSemanticKeyError

# Class: DuplicateSemanticKeyError

Defined in: [driver/src/errors.ts:132](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L132)

An application-authored stable identity was not unique in one committed tree.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new DuplicateSemanticKeyError**(`message`, `diagnostics`): `DuplicateSemanticKeyError`

Defined in: [driver/src/errors.ts:133](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L133)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`DuplicateSemanticKeyError`

#### Overrides

[`TermwrightError`](../termwrighterror/).[`constructor`](../termwrighterror/#constructor)

## Properties

### actionability?

> `optional` **actionability?**: [`ActionabilityExplanation`](../../interfaces/actionabilityexplanation/)

Defined in: [driver/src/errors.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L22)

#### Inherited from

[`TermwrightError`](../termwrighterror/).[`actionability`](../termwrighterror/#actionability)

***

### code

> `readonly` **code**: [`TermwrightErrorCode`](../../type-aliases/termwrighterrorcode/)

Defined in: [driver/src/errors.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L20)

#### Inherited from

[`TermwrightError`](../termwrighterror/).[`code`](../termwrighterror/#code)

***

### diagnostics

> `readonly` **diagnostics**: [`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

Defined in: [driver/src/errors.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L21)

#### Inherited from

[`TermwrightError`](../termwrighterror/).[`diagnostics`](../termwrighterror/#diagnostics)

## Methods

### toString()

> **toString**(): `string`

Defined in: [driver/src/errors.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L38)

Renders message + diagnostics the way test runners print failures.

#### Returns

`string`

#### Inherited from

[`TermwrightError`](../termwrighterror/).[`toString`](../termwrighterror/#tostring)

***

### withActionability()

> **withActionability**(`explanation`): `this`

Defined in: [driver/src/errors.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L32)

Attach the exact failed planner evaluation; never recomputed after state changes.

#### Parameters

##### explanation

[`ActionabilityExplanation`](../../interfaces/actionabilityexplanation/)

#### Returns

`this`

#### Inherited from

[`TermwrightError`](../termwrighterror/).[`withActionability`](../termwrighterror/#withactionability)
