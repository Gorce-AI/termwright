---
title: "Function: When()"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / When

# Function: When()

> **When**\<`Fixtures`\>(`expression`, `body`): [`StepDefinition`](../../interfaces/stepdefinition/)\<`Fixtures`\>

Defined in: [definitions.ts:109](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L109)

Declares a When definition without registering process-global state.

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
