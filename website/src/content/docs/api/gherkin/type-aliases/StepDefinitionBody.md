---
title: "Type Alias: StepDefinitionBody\\<Fixtures\\>"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / StepDefinitionBody

# Type Alias: StepDefinitionBody\<Fixtures\>

> **StepDefinitionBody**\<`Fixtures`\> = (`context`, ...`captures`) => `unknown` \| `Promise`\<`unknown`\>

Defined in: [definitions.ts:37](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L37)

Body of a Given/When/Then definition. Captures follow the context argument.

## Type Parameters

### Fixtures

`Fixtures` *extends* `object` = `object`

## Parameters

### context

[`GherkinContext`](../gherkincontext/)\<`Fixtures`\>

### captures

...readonly `unknown`[]

## Returns

`unknown` \| `Promise`\<`unknown`\>
