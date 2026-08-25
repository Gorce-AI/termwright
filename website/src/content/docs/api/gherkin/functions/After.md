---
title: "Function: After()"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / After

# Function: After()

## Call Signature

> **After**\<`Fixtures`\>(`body`): [`HookDefinition`](../../interfaces/hookdefinition/)\<`Fixtures`\>

Defined in: [definitions.ts:149](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L149)

Runs after each matching Scenario or Outline row, including failed scenarios.

### Type Parameters

#### Fixtures

`Fixtures` *extends* `object` = `object`

### Parameters

#### body

[`HookDefinitionBody`](../../type-aliases/hookdefinitionbody/)\<`Fixtures`\>

### Returns

[`HookDefinition`](../../interfaces/hookdefinition/)\<`Fixtures`\>

## Call Signature

> **After**\<`Fixtures`\>(`options`, `body`): [`HookDefinition`](../../interfaces/hookdefinition/)\<`Fixtures`\>

Defined in: [definitions.ts:150](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L150)

Runs after each matching Scenario or Outline row, including failed scenarios.

### Type Parameters

#### Fixtures

`Fixtures` *extends* `object` = `object`

### Parameters

#### options

[`HookDefinitionOptions`](../../interfaces/hookdefinitionoptions/)

#### body

[`HookDefinitionBody`](../../type-aliases/hookdefinitionbody/)\<`Fixtures`\>

### Returns

[`HookDefinition`](../../interfaces/hookdefinition/)\<`Fixtures`\>
