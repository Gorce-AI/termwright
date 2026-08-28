---
title: "Class: EvidenceConflictError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / EvidenceConflictError

# Class: EvidenceConflictError

Defined in: [driver/src/errors.ts:160](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L160)

Two authoritative producers supplied incompatible facts for one revision.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new EvidenceConflictError**(`message`, `diagnostics`): `EvidenceConflictError`

Defined in: [driver/src/errors.ts:161](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L161)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

#### Returns

`EvidenceConflictError`

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
