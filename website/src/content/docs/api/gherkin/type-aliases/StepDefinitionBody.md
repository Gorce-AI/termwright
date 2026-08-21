---
title: "Type Alias: StepDefinitionBody"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / StepDefinitionBody

# Type Alias: StepDefinitionBody

> **StepDefinitionBody** = (`context`, ...`captures`) => `unknown` \| `Promise`\<`unknown`\>

Defined in: [gherkin/src/definitions.ts:37](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L37)

Body of a Given/When/Then definition. Captures follow the context argument.

## Parameters

### context

[`GherkinContext`](../../interfaces/gherkincontext/)

### captures

...readonly `unknown`[]

## Returns

`unknown` \| `Promise`\<`unknown`\>
