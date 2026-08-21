---
title: "Function: defineSteps()"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / defineSteps

# Function: defineSteps()

> **defineSteps**(...`definitions`): [`GherkinDefinitions`](../../type-aliases/gherkindefinitions/)

Defined in: [gherkin/src/definitions.ts:149](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/definitions.ts#L149)

Creates the default export of a paired glue module.

Definitions are data, not global registrations. This is what lets two feature
files load different nearest-scope definitions safely in the same Vitest worker.

## Parameters

### definitions

...readonly [`GherkinDefinition`](../../type-aliases/gherkindefinition/)[]

## Returns

[`GherkinDefinitions`](../../type-aliases/gherkindefinitions/)
