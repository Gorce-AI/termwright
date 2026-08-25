---
title: "Function: Before()"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / Before

# Function: Before()

## Call Signature

> **Before**\<`Fixtures`\>(`body`): [`HookDefinition`](../../interfaces/hookdefinition/)\<`Fixtures`\>

Defined in: [definitions.ts:133](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L133)

Runs before each matching Scenario or Outline row selected by this glue scope.

### Type Parameters

#### Fixtures

`Fixtures` *extends* `object` = `object`

### Parameters

#### body

[`HookDefinitionBody`](../../type-aliases/hookdefinitionbody/)\<`Fixtures`\>

### Returns

[`HookDefinition`](../../interfaces/hookdefinition/)\<`Fixtures`\>

## Call Signature

> **Before**\<`Fixtures`\>(`options`, `body`): [`HookDefinition`](../../interfaces/hookdefinition/)\<`Fixtures`\>

Defined in: [definitions.ts:134](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L134)

Runs before each matching Scenario or Outline row selected by this glue scope.

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
