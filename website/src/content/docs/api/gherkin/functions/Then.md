---
title: "Function: Then()"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / Then

# Function: Then()

> **Then**\<`Fixtures`\>(`expression`, `body`): [`StepDefinition`](../../interfaces/stepdefinition/)\<`Fixtures`\>

Defined in: [definitions.ts:117](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L117)

Declares a Then definition without registering process-global state.

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
