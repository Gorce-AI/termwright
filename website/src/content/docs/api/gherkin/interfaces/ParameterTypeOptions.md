---
title: "Interface: ParameterTypeOptions"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / ParameterTypeOptions

# Interface: ParameterTypeOptions\<T\>

Defined in: [definitions.ts:74](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L74)

Options accepted by [defineParameterType](../../functions/defineparametertype/).

## Type Parameters

### T

`T`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [definitions.ts:75](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L75)

***

### preferForRegexpMatch?

> `readonly` `optional` **preferForRegexpMatch?**: `boolean`

Defined in: [definitions.ts:79](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L79)

***

### regexp

> `readonly` **regexp**: `RegExp` \| readonly `RegExp`[]

Defined in: [definitions.ts:76](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L76)

***

### transformer

> `readonly` **transformer**: (...`groups`) => `T` \| `Promise`\<`T`\>

Defined in: [definitions.ts:77](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L77)

#### Parameters

##### groups

...readonly `string`[]

#### Returns

`T` \| `Promise`\<`T`\>

***

### useForSnippets?

> `readonly` `optional` **useForSnippets?**: `boolean`

Defined in: [definitions.ts:78](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L78)
