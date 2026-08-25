---
title: "Interface: GherkinPluginOptions"
editUrl: false
---

[**@termwright/gherkin**](../../)

***

[@termwright/gherkin](../../) / GherkinPluginOptions

# Interface: GherkinPluginOptions

Defined in: [plugin.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L18)

## Properties

### featureRoot?

> `readonly` `optional` **featureRoot?**: `string`

Defined in: [plugin.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L20)

Directory against which feature paths and pairing templates are resolved. Defaults to Vite's root.

***

### fixtureNames?

> `readonly` `optional` **fixtureNames?**: readonly `string`[]

Defined in: [plugin.ts:35](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L35)

Custom `test.extend()` fixture names forwarded into every Gherkin context.

***

### generatedImports?

> `readonly` `optional` **generatedImports?**: [`GeneratedGherkinImports`](../generatedgherkinimports/)

Defined in: [plugin.ts:33](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L33)

Module specifiers emitted into transformed feature files.

***

### includeFeatures?

> `readonly` `optional` **includeFeatures?**: `boolean`

Defined in: [plugin.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L31)

Add physical `.feature` files to Vitest discovery. Used by managed hosts
such as `termwright ui`.

The feature patterns are derived from the resolved Vitest `test.include`
patterns. This deliberately does not widen a narrowly configured suite to
every feature below the project root.

***

### stepDefinitions?

> `readonly` `optional` **stepDefinitions?**: readonly `string`[]

Defined in: [plugin.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L22)

Cypress-compatible `[filepath]` / `[filepart]` glue patterns.

***

### tags?

> `readonly` `optional` **tags?**: `string`

Defined in: [plugin.ts:37](https://github.com/Gorce-AI/termwright/blob/main/packages/gherkin/src/plugin.ts#L37)

Cucumber tag expression selecting Scenario and Outline cases.
