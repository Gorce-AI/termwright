---
title: "Interface: GherkinPluginOptions"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / GherkinPluginOptions

# Interface: GherkinPluginOptions\<Fixtures\>

Defined in: [plugin.ts:45](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L45)

Options for a Gherkin transform using an optional project fixture surface.

## Type Parameters

### Fixtures

`Fixtures` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### featureRoot?

> `readonly` `optional` **featureRoot?**: `string`

Defined in: [plugin.ts:47](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L47)

Directory against which feature paths and pairing templates are resolved. Defaults to Vite's root.

***

### fixtureNames?

> `readonly` `optional` **fixtureNames?**: readonly `Exclude`\<`Extract`\<keyof `Fixtures`, `string`\>, [`GherkinReservedFixtureName`](../../type-aliases/gherkinreservedfixturename/)\>[]

Defined in: [plugin.ts:62](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L62)

Custom `test.extend()` fixture names forwarded into every Gherkin context.

***

### generatedImports?

> `readonly` `optional` **generatedImports?**: [`GeneratedGherkinImports`](../generatedgherkinimports/)

Defined in: [plugin.ts:60](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L60)

Module specifiers emitted into transformed feature files.

***

### includeFeatures?

> `readonly` `optional` **includeFeatures?**: `boolean`

Defined in: [plugin.ts:58](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L58)

Add physical `.feature` files to Vitest discovery. Used by managed hosts
such as `termwright ui`.

The feature patterns are derived from the resolved Vitest `test.include`
patterns. This deliberately does not widen a narrowly configured suite to
every feature below the project root.

***

### scenario?

> `readonly` `optional` **scenario?**: (`scenario`) => [`GherkinScenarioOptions`](../gherkinscenariooptions/) \| `undefined`

Defined in: [plugin.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L69)

Maps authored scenario metadata/tags to native timeout and admission resources.

#### Parameters

##### scenario

[`GherkinScenario`](../gherkinscenario/)

#### Returns

[`GherkinScenarioOptions`](../gherkinscenariooptions/) \| `undefined`

***

### stepDefinitions?

> `readonly` `optional` **stepDefinitions?**: readonly `string`[]

Defined in: [plugin.ts:49](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L49)

Cypress-compatible `[filepath]` / `[filepart]` glue patterns.

***

### tags?

> `readonly` `optional` **tags?**: `string`

Defined in: [plugin.ts:67](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L67)

Cucumber tag expression selecting Scenario and Outline cases.
