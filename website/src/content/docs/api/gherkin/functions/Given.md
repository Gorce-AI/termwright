---
title: "Function: Given()"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / Given

# Function: Given()

> **Given**\<`Fixtures`\>(`expression`, `body`): [`StepDefinition`](../../interfaces/stepdefinition/)\<`Fixtures`\>

Defined in: [definitions.ts:101](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L101)

Declares a Given definition without registering process-global state.

## Type Parameters

### Fixtures

`Fixtures` *extends* `object` = `object`

## Parameters

### expression

`string` \| `RegExp`

### body

[`StepDefinitionBody`](../../type-aliases/stepdefinitionbody/)\<`Fixtures`\>

## Returns

[`StepDefinition`](../../interfaces/stepdefinition/)\<`Fixtures`\>
