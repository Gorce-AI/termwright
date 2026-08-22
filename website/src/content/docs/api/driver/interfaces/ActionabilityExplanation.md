---
title: "Interface: ActionabilityExplanation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionabilityExplanation

# Interface: ActionabilityExplanation

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:841

## Properties

### actionable

> `readonly` **actionable**: `boolean`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:842

***

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:844

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:843

***

### reason?

> `readonly` `optional` **reason?**: `object`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:847

#### code

> `readonly` **code**: `string`

#### message

> `readonly` **message**: `string`

#### targetRef?

> `readonly` `optional` **targetRef?**: [`LocatorRef`](../../type-aliases/locatorref/)

***

### requirements

> `readonly` **requirements**: readonly [`ConditionResult`](../conditionresult/)[]

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:845

***

### strategy?

> `readonly` `optional` **strategy?**: `string`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:846
