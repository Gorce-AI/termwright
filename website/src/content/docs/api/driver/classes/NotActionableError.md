---
title: "Class: NotActionableError"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / NotActionableError

# Class: NotActionableError

Defined in: [driver/src/errors.ts:108](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L108)

The capability exists, but the target cannot currently satisfy the action.

## Extends

- [`TermwrightError`](../termwrighterror/)

## Constructors

### Constructor

> **new NotActionableError**(`message`, `diagnostics`, `transient?`): `NotActionableError`

Defined in: [driver/src/errors.ts:112](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L112)

#### Parameters

##### message

`string`

##### diagnostics

[`ErrorDiagnostics`](../../interfaces/errordiagnostics/)

##### transient?

`"pointer-region"` \| `"target-state"` \| `"covered"` \| `null`

#### Returns

`NotActionableError`

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

***

### transient

> `readonly` **transient**: `"pointer-region"` \| `"target-state"` \| `"covered"` \| `null`

Defined in: [driver/src/errors.ts:110](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/errors.ts#L110)

Only these planner facts may become actionable on a later committed observation.

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
