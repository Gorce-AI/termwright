---
title: "Interface: ParameterTypeOptions\\<T\\>"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / ParameterTypeOptions

# Interface: ParameterTypeOptions\<T\>

Defined in: [definitions.ts:70](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L70)

Options accepted by [defineParameterType](../../functions/defineparametertype/).

## Type Parameters

### T

`T`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [definitions.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L71)

***

### preferForRegexpMatch?

> `readonly` `optional` **preferForRegexpMatch?**: `boolean`

Defined in: [definitions.ts:75](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L75)

***

### regexp

> `readonly` **regexp**: `RegExp` \| readonly `RegExp`[]

Defined in: [definitions.ts:72](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L72)

***

### transformer

> `readonly` **transformer**: (...`groups`) => `T` \| `Promise`\<`T`\>

Defined in: [definitions.ts:73](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L73)

#### Parameters

##### groups

...readonly `string`[]

#### Returns

`T` \| `Promise`\<`T`\>

***

### useForSnippets?

> `readonly` `optional` **useForSnippets?**: `boolean`

Defined in: [definitions.ts:74](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L74)
