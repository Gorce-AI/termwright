---
title: "Function: defineSteps()"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / defineSteps

# Function: defineSteps()

> **defineSteps**\<`Fixtures`\>(...`definitions`): [`GherkinDefinitions`](../../type-aliases/gherkindefinitions/)\<`Fixtures`\>

Defined in: [definitions.ts:192](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L192)

Creates the default export of a paired glue module.

Definitions are data, not global registrations. This is what lets two feature
files load different nearest-scope definitions safely in the same Vitest worker.

## Type Parameters

### Fixtures

`Fixtures` *extends* `object` = `object`

## Parameters

### definitions

...readonly [`GherkinDefinition`](../../type-aliases/gherkindefinition/)\<`Fixtures`\>[]

## Returns

[`GherkinDefinitions`](../../type-aliases/gherkindefinitions/)\<`Fixtures`\>
