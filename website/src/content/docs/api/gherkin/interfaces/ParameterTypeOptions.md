---
title: "Interface: ParameterTypeOptions\\<T\\>"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / ParameterTypeOptions

# Interface: ParameterTypeOptions\<T\>

Defined in: [gherkin/src/definitions.ts:67](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L67)

Options accepted by [defineParameterType](../../functions/defineparametertype/).

## Type Parameters

### T

`T`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [gherkin/src/definitions.ts:68](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L68)

***

### preferForRegexpMatch?

> `readonly` `optional` **preferForRegexpMatch?**: `boolean`

Defined in: [gherkin/src/definitions.ts:72](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L72)

***

### regexp

> `readonly` **regexp**: `RegExp` \| readonly `RegExp`[]

Defined in: [gherkin/src/definitions.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L69)

***

### transformer

> `readonly` **transformer**: (...`groups`) => `T` \| `Promise`\<`T`\>

Defined in: [gherkin/src/definitions.ts:70](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L70)

#### Parameters

##### groups

...readonly `string`[]

#### Returns

`T` \| `Promise`\<`T`\>

***

### useForSnippets?

> `readonly` `optional` **useForSnippets?**: `boolean`

Defined in: [gherkin/src/definitions.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L71)
