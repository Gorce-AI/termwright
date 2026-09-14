---
title: "Interface: ActionabilityExplanation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionabilityExplanation

# Interface: ActionabilityExplanation

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:220

## Properties

### actionable

> `readonly` **actionable**: `boolean`

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:221

***

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:223

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:222

***

### reason?

> `readonly` `optional` **reason?**: `object`

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:226

#### code

> `readonly` **code**: `string`

#### message

> `readonly` **message**: `string`

#### targetRef?

> `readonly` `optional` **targetRef?**: [`LocatorRef`](../../type-aliases/locatorref/)

***

### requirements

> `readonly` **requirements**: readonly [`ConditionResult`](../conditionresult/)[]

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:224

***

### strategy?

> `readonly` `optional` **strategy?**: `string`

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:225
