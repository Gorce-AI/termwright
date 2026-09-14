---
title: "Interface: GherkinPluginOptions"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / GherkinPluginOptions

# Interface: GherkinPluginOptions\<Fixtures\>

Defined in: [plugin.ts:46](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L46)

Options for a Gherkin transform using an optional project fixture surface.

## Type Parameters

### Fixtures

`Fixtures` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### featureRoot?

> `readonly` `optional` **featureRoot?**: `string`

Defined in: [plugin.ts:48](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L48)

Directory against which feature paths and pairing templates are resolved. Defaults to Vite's root.

***

### fixtureNames?

> `readonly` `optional` **fixtureNames?**: readonly `Exclude`\<`Extract`\<keyof `Fixtures`, `string`\>, [`GherkinReservedFixtureName`](../../type-aliases/gherkinreservedfixturename/)\>[]

Defined in: [plugin.ts:63](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L63)

Custom `test.extend()` fixture names forwarded into every Gherkin context.

***

### generatedImports?

> `readonly` `optional` **generatedImports?**: [`GeneratedGherkinImports`](../generatedgherkinimports/)

Defined in: [plugin.ts:61](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L61)

Module specifiers emitted into transformed feature files.

***

### includeFeatures?

> `readonly` `optional` **includeFeatures?**: `boolean`

Defined in: [plugin.ts:59](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L59)

Add physical `.feature` files to Vitest discovery. Used by managed hosts
such as `termwright ui`.

The feature patterns are derived from the resolved Vitest `test.include`
patterns. This deliberately does not widen a narrowly configured suite to
every feature below the project root.

***

### scenario?

> `readonly` `optional` **scenario?**: (`scenario`) => [`GherkinScenarioOptions`](../gherkinscenariooptions/) \| `undefined`

Defined in: [plugin.ts:70](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L70)

Maps authored scenario metadata/tags to native timeout and admission resources.

#### Parameters

##### scenario

[`GherkinScenario`](../gherkinscenario/)

#### Returns

[`GherkinScenarioOptions`](../gherkinscenariooptions/) \| `undefined`

***

### stepDefinitions?

> `readonly` `optional` **stepDefinitions?**: readonly `string`[]

Defined in: [plugin.ts:50](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L50)

Cypress-compatible `[filepath]` / `[filepart]` glue patterns.

***

### tags?

> `readonly` `optional` **tags?**: `string`

Defined in: [plugin.ts:68](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L68)

Cucumber tag expression selecting Scenario and Outline cases.
