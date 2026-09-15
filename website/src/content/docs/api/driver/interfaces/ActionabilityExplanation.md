---
title: "Interface: ActionabilityExplanation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionabilityExplanation

# Interface: ActionabilityExplanation

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:224

## Properties

### actionable

> `readonly` **actionable**: `boolean`

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:225

***

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:227

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:226

***

### reason?

> `readonly` `optional` **reason?**: `object`

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:230

#### code

> `readonly` **code**: `string`

#### message

> `readonly` **message**: `string`

#### targetRef?

> `readonly` `optional` **targetRef?**: [`LocatorRef`](../../type-aliases/locatorref/)

***

### requirements

> `readonly` **requirements**: readonly [`ConditionResult`](../conditionresult/)[]

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:228

***

### strategy?

> `readonly` `optional` **strategy?**: `string`

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:229
